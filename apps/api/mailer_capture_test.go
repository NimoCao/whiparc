package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"net"
	"net/http"
	"net/http/httptest"
	"net/mail"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCleanFreeTextAndSingleLine(t *testing.T) {
	if got := cleanFreeText("a\r\nb\rc\x00d\x07e\tf", 100); got != "a\nb\ncde\tf" {
		t.Fatalf("cleanFreeText = %q", got)
	}
	if got := cleanFreeText("  padded  ", 100); got != "padded" {
		t.Fatalf("cleanFreeText trim = %q", got)
	}
	if got := cleanFreeText(strings.Repeat("é", 50), 10); len([]rune(got)) != 10 {
		t.Fatalf("truncation counts runes, got %d", len([]rune(got)))
	}
	if got := cleanSingleLine("Ada\r\nBcc: x\tY\x00Z", 100); strings.ContainsAny(got, "\r\n\t\x00") {
		t.Fatalf("cleanSingleLine left control chars: %q", got)
	}
	if got := cleanFreeText("bad\xffbyte", 100); !strings.Contains(got, "\uFFFD") {
		t.Fatalf("invalid UTF-8 should be replaced, got %q", got)
	}
}

func TestNotificationSubjectAndText(t *testing.T) {
	c := notificationSubject(InboxNotification{Kind: "contact", FromName: "Ada\r\nBcc: x@acme-corp.dev", FromEmail: "ada@acme-corp.dev"})
	if strings.ContainsAny(c, "\r\n") || !strings.HasPrefix(c, "[Whiparc contact] ") {
		t.Fatalf("contact subject = %q", c)
	}
	if got := notificationSubject(InboxNotification{Kind: "contact", FromEmail: "ada@acme-corp.dev"}); !strings.Contains(got, "ada@acme-corp.dev") {
		t.Fatalf("falls back to the address when there is no name: %q", got)
	}
	if got := notificationSubject(InboxNotification{Kind: "inbound"}); got != "[Whiparc inbound] (no subject)" {
		t.Fatalf("inbound subject = %q", got)
	}
	if got := notificationSubject(InboxNotification{Kind: "inbound", Subject: strings.Repeat("s", 400)}); len([]rune(got)) > len("[Whiparc inbound] ")+maxNotificationSubjectRunes {
		t.Fatalf("subject not truncated: %d runes", len([]rune(got)))
	}
	text := notificationText(InboxNotification{Kind: "inbound", FromName: "Ada", FromEmail: "ada@acme-corp.dev", Subject: "Hi", Body: "line1\r\nline2"})
	for _, want := range []string{"Ada <ada@acme-corp.dev>", "Subject: Hi", "line1\nline2"} {
		if !strings.Contains(text, want) {
			t.Fatalf("notification text missing %q:\n%s", want, text)
		}
	}
}

func TestBrandedEmailHTMLEscapes(t *testing.T) {
	out := brandedEmailHTML(`T<script>`, `intro "quoted" <b>`, `Go`, `https://whiparc.com/x?a=1&b="2"`, `foot<i>`)
	for _, bad := range []string{"<script>", "<b>", "<i>", `b="2"`} {
		if strings.Contains(out, bad) {
			t.Fatalf("unescaped %q in output", bad)
		}
	}
	if !strings.Contains(out, "&amp;b=&#34;2&#34;") {
		t.Fatalf("link not escaped as an attribute value: %s", out)
	}
	if strings.Contains(brandedEmailHTML("t", "i", "", "", "f"), "<a ") {
		t.Fatal("no CTA expected when there is no link")
	}
}

func TestBuildPlainMessageCannotInjectHeaders(t *testing.T) {
	body := "hello\nBcc: attacker@acme-corp.dev\n\nMore."
	raw := buildPlainMessage("Whiparc <hello@whiparc.com>", "owner@acme-corp.dev", "ada@acme-corp.dev", "Re: ünï\r\nBcc: attacker@acme-corp.dev", body)

	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("not a valid RFC 5322 message: %v", err)
	}
	if msg.Header.Get("Bcc") != "" {
		t.Fatal("a Bcc header was injected")
	}
	for _, h := range []string{"From", "To", "Reply-To", "Subject", "Date", "Message-Id", "Mime-Version"} {
		if msg.Header.Get(h) == "" {
			t.Fatalf("missing header %s", h)
		}
	}
	subject, err := (&mime.WordDecoder{}).DecodeHeader(msg.Header.Get("Subject"))
	if err != nil || !strings.Contains(subject, "ünï") || strings.ContainsAny(subject, "\r\n") {
		t.Fatalf("subject decode: %q, %v", subject, err)
	}
	encoded, _ := io.ReadAll(msg.Body)
	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.TrimSpace(string(encoded)), "\r\n", ""))
	if err != nil {
		t.Fatalf("body is not valid base64: %v", err)
	}
	if got := strings.ReplaceAll(string(decoded), "\r\n", "\n"); got != body {
		t.Fatalf("body round trip = %q", got)
	}
	for _, line := range strings.Split(string(encoded), "\r\n") {
		if len(line) > 76 {
			t.Fatalf("base64 line over 76 chars: %d", len(line))
		}
	}
}

// ---- A minimal in-process SMTP server --------------------------------

type capturedSMTP struct {
	from string
	to   []string
	data string
}

func startFakeSMTP(t *testing.T) (host string, port int, out chan capturedSMTP) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	out = make(chan capturedSMTP, 4)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_ = c.SetDeadline(time.Now().Add(5 * time.Second))
				r := bufio.NewReader(c)
				say := func(s string) { _, _ = c.Write([]byte(s + "\r\n")) }
				say("220 fake ESMTP")
				var cur capturedSMTP
				for {
					line, err := r.ReadString('\n')
					if err != nil {
						return
					}
					line = strings.TrimRight(line, "\r\n")
					upper := strings.ToUpper(line)
					switch {
					case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "HELO"):
						say("250 fake")
					case strings.HasPrefix(upper, "MAIL FROM:"):
						cur.from = strings.Trim(line[len("MAIL FROM:"):], "<> ")
						say("250 ok")
					case strings.HasPrefix(upper, "RCPT TO:"):
						cur.to = append(cur.to, strings.Trim(line[len("RCPT TO:"):], "<> "))
						say("250 ok")
					case upper == "DATA":
						say("354 go")
						var b strings.Builder
						for {
							l, err := r.ReadString('\n')
							if err != nil {
								return
							}
							if l == ".\r\n" {
								break
							}
							b.WriteString(strings.TrimPrefix(l, ".")) // undo dot-stuffing
						}
						cur.data = b.String()
						out <- cur
						say("250 queued")
					case upper == "QUIT":
						say("221 bye")
						return
					default:
						say("250 ok")
					}
				}
			}(conn)
		}
	}()

	addr := ln.Addr().(*net.TCPAddr)
	return "127.0.0.1", addr.Port, out
}

func readSMTP(t *testing.T, ch chan capturedSMTP) (capturedSMTP, *mail.Message, string) {
	t.Helper()
	select {
	case got := <-ch:
		msg, err := mail.ReadMessage(strings.NewReader(got.data))
		if err != nil {
			t.Fatalf("server received an unparseable message: %v\n%s", err, got.data)
		}
		raw, _ := io.ReadAll(msg.Body)
		decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.TrimSpace(string(raw)), "\r\n", ""))
		if err != nil {
			t.Fatalf("body not base64: %v", err)
		}
		return got, msg, strings.ReplaceAll(string(decoded), "\r\n", "\n")
	case <-time.After(3 * time.Second):
		t.Fatal("no message reached the SMTP server")
		return capturedSMTP{}, nil, ""
	}
}

func TestSMTPMailerSendsCaptureEmails(t *testing.T) {
	host, port, out := startFakeSMTP(t)
	m := &SMTPMailer{host: host, port: port, from: "Whiparc <hello@whiparc.com>"}

	if err := m.SendNewsletterConfirmation("Reader@acme-corp.dev", "https://whiparc.com/newsletter/confirm?token=abc123", "https://whiparc.com/newsletter/unsubscribe?token=def456"); err != nil {
		t.Fatalf("confirmation: %v", err)
	}
	got, msg, body := readSMTP(t, out)
	if got.from != "hello@whiparc.com" || len(got.to) != 1 || got.to[0] != "Reader@acme-corp.dev" {
		t.Fatalf("envelope = %+v", got)
	}
	if !strings.Contains(msg.Header.Get("From"), "hello@whiparc.com") {
		t.Fatalf("From header = %q", msg.Header.Get("From"))
	}
	if !strings.Contains(body, "https://whiparc.com/newsletter/confirm?token=abc123") || !strings.Contains(body, "unsubscribe?token=def456") {
		t.Fatalf("links missing from body:\n%s", body)
	}

	// The notification carries a Reply-To so answering it reaches the sender.
	if err := m.SendInboxNotification("owner@acme-corp.dev", InboxNotification{Kind: "contact", FromName: "Ada", FromEmail: "ada@acme-corp.dev", Body: "Hi there.\n.\nA line that is a lone dot above."}); err != nil {
		t.Fatalf("notification: %v", err)
	}
	_, msg, body = readSMTP(t, out)
	if msg.Header.Get("Reply-To") != "ada@acme-corp.dev" {
		t.Fatalf("Reply-To = %q", msg.Header.Get("Reply-To"))
	}
	if !strings.Contains(body, "Hi there.\n.\nA line that is a lone dot above.") {
		t.Fatalf("body mangled:\n%s", body)
	}

	if err := m.SendContactAcknowledgement("ada@acme-corp.dev", "Ada\r\nBcc: x@acme-corp.dev"); err != nil {
		t.Fatalf("ack: %v", err)
	}
	_, msg, body = readSMTP(t, out)
	if msg.Header.Get("Bcc") != "" || strings.Contains(body, "Bcc") {
		t.Fatalf("injected content survived:\n%s", body)
	}
}

func TestSMTPMailerFallsBackWhenFromIsUnusable(t *testing.T) {
	host, port, out := startFakeSMTP(t)
	m := &SMTPMailer{host: host, port: port, from: "not an address"}
	if err := m.SendContactAcknowledgement("ada@acme-corp.dev", "Ada"); err != nil {
		t.Fatal(err)
	}
	got, _, _ := readSMTP(t, out)
	if got.from != "noreply@whiparc.com" {
		t.Fatalf("envelope sender = %q", got.from)
	}
}

func TestSMTPMailerRejectsBadRecipientsAndLinks(t *testing.T) {
	m := &SMTPMailer{host: "127.0.0.1", port: 1, from: "hello@whiparc.com"}
	if err := m.SendContactAcknowledgement("not an address", "Ada"); err == nil {
		t.Fatal("expected an error for an invalid recipient")
	}
	if err := m.SendNewsletterConfirmation("ada@acme-corp.dev", "::bad::", "https://whiparc.com/u"); err == nil {
		t.Fatal("expected an error for an invalid confirmation link")
	}
	if err := m.SendInboxNotification("bad", InboxNotification{Kind: "contact"}); err == nil {
		t.Fatal("expected an error for an invalid notification recipient")
	}
}

func TestResendMailerCapturePayloads(t *testing.T) {
	var gotAuth string
	var payloads []map[string]interface{}
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		var p map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&p)
		payloads = append(payloads, p)
		w.WriteHeader(status)
	}))
	defer srv.Close()
	m := &ResendMailer{apiKey: "re_test", from: "Whiparc <hello@whiparc.com>", client: srv.Client(), endpoint: srv.URL}

	if err := m.SendNewsletterConfirmation("reader@acme-corp.dev", "https://whiparc.com/c?token=abc&x=1", "https://whiparc.com/u?token=def"); err != nil {
		t.Fatal(err)
	}
	p := payloads[0]
	if gotAuth != "Bearer re_test" || p["from"] != "Whiparc <hello@whiparc.com>" || p["subject"] != "Confirm your subscription to Whiparc updates" {
		t.Fatalf("payload = %+v (auth %q)", p, gotAuth)
	}
	if h, _ := p["headers"].(map[string]interface{}); h["List-Unsubscribe"] != "<https://whiparc.com/u?token=def>" {
		t.Fatalf("List-Unsubscribe header = %v", p["headers"])
	}
	if !strings.Contains(p["html"].(string), "token=abc&amp;x=1") || !strings.Contains(p["text"].(string), "token=abc&x=1") {
		t.Fatalf("link must be escaped in html and raw in text:\nhtml=%v\ntext=%v", p["html"], p["text"])
	}

	if err := m.SendInboxNotification("owner@acme-corp.dev", InboxNotification{Kind: "contact", FromName: "Ada <script>", FromEmail: "ada@acme-corp.dev", Body: "<img src=x onerror=alert(1)>"}); err != nil {
		t.Fatal(err)
	}
	p = payloads[1]
	if p["reply_to"] != "ada@acme-corp.dev" {
		t.Fatalf("reply_to = %v", p["reply_to"])
	}
	if _, hasHTML := p["html"]; hasHTML {
		t.Fatal("notifications must be plain text only")
	}

	if err := m.SendInboxNotification("owner@acme-corp.dev", InboxNotification{Kind: "inbound", FromEmail: "not valid", Body: "x"}); err != nil {
		t.Fatal(err)
	}
	if _, has := payloads[2]["reply_to"]; has {
		t.Fatal("an unusable sender address must not become reply_to")
	}

	if err := m.SendContactAcknowledgement("ada@acme-corp.dev", "Ada"); err != nil {
		t.Fatal(err)
	}

	status = http.StatusUnprocessableEntity
	err := m.SendContactAcknowledgement("ada@acme-corp.dev", "Ada")
	if err == nil || !strings.Contains(err.Error(), strconv.Itoa(http.StatusUnprocessableEntity)) {
		t.Fatalf("a non-2xx response must surface as an error, got %v", err)
	}
}

func TestConsoleMailerCaptureMethodsDoNotFail(t *testing.T) {
	c := &ConsoleMailer{}
	if err := c.SendNewsletterConfirmation("a@acme-corp.dev", "http://localhost:3000/newsletter/confirm?token=t", "http://localhost:3000/newsletter/unsubscribe?token=u"); err != nil {
		t.Fatal(err)
	}
	if err := c.SendContactAcknowledgement("a@acme-corp.dev", "Ada"); err != nil {
		t.Fatal(err)
	}
	if err := c.SendInboxNotification("o@acme-corp.dev", InboxNotification{Kind: "contact", FromEmail: "a@acme-corp.dev", Body: "x"}); err != nil {
		t.Fatal(err)
	}
}
