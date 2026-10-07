package main

import (
	"net/http"
	"strings"
	"testing"
)

const testInboundSecret = "s3cret-for-tests-only"

func inboundHeaders() map[string]string {
	return map[string]string{"X-Webhook-Secret": testInboundSecret}
}

func countInbound(t *testing.T) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM inbound_emails").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestInboundDisabledWithoutSecret(t *testing.T) {
	setupCaptureTest(t) // leaves INBOUND_EMAIL_SECRET empty
	w := postJSON(handleInboundEmail, "/api/inbound/email", `{"from":"a@acme-corp.dev","to":"hello@whiparc.com"}`, inboundHeaders())
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured endpoint: got %d, want 503 (it must fail closed)", w.Code)
	}
	if countInbound(t) != 0 {
		t.Fatal("message stored while endpoint was unconfigured")
	}
}

func TestInboundAuth(t *testing.T) {
	setupCaptureTest(t)
	t.Setenv("INBOUND_EMAIL_SECRET", testInboundSecret)
	body := `{"from":"a@acme-corp.dev","to":"hello@whiparc.com","subject":"hi","text":"body","messageId":"auth-1"}`

	for label, headers := range map[string]map[string]string{
		"no credentials": nil,
		"wrong secret":   {"X-Webhook-Secret": "nope"},
		"wrong bearer":   {"Authorization": "Bearer nope"},
		"prefix only":    {"X-Webhook-Secret": testInboundSecret[:5]},
		"basic scheme":   {"Authorization": "Basic " + testInboundSecret},
	} {
		if w := postJSON(handleInboundEmail, "/api/inbound/email", body, headers); w.Code != http.StatusUnauthorized {
			t.Fatalf("%s: got %d, want 401", label, w.Code)
		}
	}
	if countInbound(t) != 0 {
		t.Fatal("unauthenticated request stored a message")
	}

	if w := postJSON(handleInboundEmail, "/api/inbound/email", body, inboundHeaders()); w.Code != http.StatusOK {
		t.Fatalf("header secret: %d %s", w.Code, w.Body.String())
	}
	bearer := strings.Replace(body, "auth-1", "auth-2", 1)
	if w := postJSON(handleInboundEmail, "/api/inbound/email", bearer, map[string]string{"Authorization": "Bearer " + testInboundSecret}); w.Code != http.StatusOK {
		t.Fatalf("bearer secret: %d %s", w.Code, w.Body.String())
	}
	if countInbound(t) != 2 {
		t.Fatalf("stored %d messages, want 2", countInbound(t))
	}
}

func TestInboundParsesProviderShapes(t *testing.T) {
	cases := map[string]string{
		"normalized": `{"from":"Ada Lovelace <ada@acme-corp.dev>","to":"hello@whiparc.com","subject":"Hi","text":"plain body","html":"<p>plain body</p>","messageId":"m-1"}`,
		"postmark": `{"From":"Ada Lovelace <ada@acme-corp.dev>","FromFull":{"Email":"ada@acme-corp.dev","Name":"Ada Lovelace"},"To":"Whiparc <hello@whiparc.com>",
			"Subject":"Hi","TextBody":"plain body","HtmlBody":"<p>plain body</p>","MessageID":"m-2"}`,
		"enveloped":      `{"type":"email.received","data":{"from":"Ada Lovelace <ada@acme-corp.dev>","to":["hello@whiparc.com"],"subject":"Hi","text":"plain body","html":"<p>plain body</p>","email_id":"m-3"}}`,
		"object address": `{"from":{"email":"ADA@acme-corp.dev","name":"Ada Lovelace"},"to":[{"email":"hello@whiparc.com"}],"subject":"Hi","text":"plain body","id":"m-4"}`,
	}
	for label, raw := range cases {
		msg, err := parseInboundEmail([]byte(raw))
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		if msg.FromEmail != "ada@acme-corp.dev" || msg.ToEmail != "hello@whiparc.com" || msg.Subject != "Hi" || msg.Text != "plain body" || msg.MessageID == "" {
			t.Fatalf("%s: parsed %+v", label, msg)
		}
		if msg.FromName != "Ada Lovelace" {
			t.Fatalf("%s: from name %q", label, msg.FromName)
		}
	}
}

func TestInboundRejectsUnusableMessages(t *testing.T) {
	setupCaptureTest(t)
	t.Setenv("INBOUND_EMAIL_SECRET", testInboundSecret)
	for label, body := range map[string]string{
		"not json":       "{nope",
		"json array":     `[1,2,3]`,
		"no sender":      `{"to":"hello@whiparc.com","text":"x"}`,
		"junk sender":    `{"from":"not an address","to":"hello@whiparc.com"}`,
		"no recipient":   `{"from":"a@acme-corp.dev","text":"x"}`,
		"injection addr": `{"from":"a@acme-corp.dev\r\nBcc: x@acme-corp.dev","to":"hello@whiparc.com"}`,
	} {
		if w := postJSON(handleInboundEmail, "/api/inbound/email", body, inboundHeaders()); w.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d, want 400 (%s)", label, w.Code, w.Body.String())
		}
	}
	if countInbound(t) != 0 {
		t.Fatal("a rejected message was stored")
	}
}

func TestInboundIsIdempotentOnMessageID(t *testing.T) {
	mailer := setupCaptureTest(t)
	t.Setenv("INBOUND_EMAIL_SECRET", testInboundSecret)
	body := `{"from":"ada@acme-corp.dev","to":"hello@whiparc.com","subject":"Hi","text":"hello there","messageId":"dup-1"}`

	first := postJSON(handleInboundEmail, "/api/inbound/email", body, inboundHeaders())
	second := postJSON(handleInboundEmail, "/api/inbound/email", body, inboundHeaders())
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("retry must be a 2xx so the provider stops retrying: %d / %d", first.Code, second.Code)
	}
	if !strings.Contains(first.Body.String(), "stored") || !strings.Contains(second.Body.String(), "duplicate") {
		t.Fatalf("bodies: %s | %s", first.Body.String(), second.Body.String())
	}
	if countInbound(t) != 1 {
		t.Fatalf("stored %d rows for one message", countInbound(t))
	}
	waitFor(t, "forwarded notification", func() bool { _, _, n := mailer.counts(); return n == 1 })
	settle()
	if _, _, n := mailer.counts(); n != 1 {
		t.Fatalf("duplicate delivery forwarded %d times", n)
	}

	// Messages without an id are not de-duplicated (NULLs are distinct).
	noID := `{"from":"ada@acme-corp.dev","to":"hello@whiparc.com","text":"no id"}`
	postJSON(handleInboundEmail, "/api/inbound/email", noID, inboundHeaders())
	postJSON(handleInboundEmail, "/api/inbound/email", noID, inboundHeaders())
	if countInbound(t) != 3 {
		t.Fatalf("expected 3 rows, got %d", countInbound(t))
	}
}

func TestInboundForwardsToOwnerAndSkipsOwnSenders(t *testing.T) {
	mailer := setupCaptureTest(t)
	t.Setenv("INBOUND_EMAIL_SECRET", testInboundSecret)
	t.Setenv("EMAIL_FROM", "Whiparc <hello@whiparc.com>")

	postJSON(handleInboundEmail, "/api/inbound/email", `{"from":"Ada <ada@acme-corp.dev>","to":"hello@whiparc.com","subject":"Question","html":"<b>only html</b>","messageId":"f-1"}`, inboundHeaders())
	waitFor(t, "forward", func() bool { _, _, n := mailer.counts(); return n == 1 })
	mailer.mu.Lock()
	notice := mailer.notices[0]
	mailer.mu.Unlock()
	if notice.to != "owner@acme-corp.dev" || notice.n.Kind != "inbound" || notice.n.FromEmail != "ada@acme-corp.dev" || notice.n.Subject != "Question" {
		t.Fatalf("unexpected notice %+v", notice)
	}
	if strings.Contains(notice.n.Body, "<b>") || !strings.Contains(notice.n.Body, "no plain-text part") {
		t.Fatalf("HTML must never be forwarded as the body: %q", notice.n.Body)
	}

	// Mail from our own sender addresses is archived but not forwarded, so a
	// notification that routes back into the mailbox cannot loop.
	for _, own := range []string{"noreply@whiparc.com", "hello@whiparc.com"} {
		postJSON(handleInboundEmail, "/api/inbound/email", `{"from":"`+own+`","to":"hello@whiparc.com","text":"echo","messageId":"own-`+own+`"}`, inboundHeaders())
	}
	settle()
	if _, _, n := mailer.counts(); n != 1 {
		t.Fatalf("own-sender mail was forwarded (%d notices)", n)
	}
	if countInbound(t) != 3 {
		t.Fatalf("own-sender mail should still be archived, have %d rows", countInbound(t))
	}
}

func TestInboundSanitizesStoredContent(t *testing.T) {
	setupCaptureTest(t)
	t.Setenv("INBOUND_EMAIL_SECRET", testInboundSecret)
	// \u0000 would make Postgres reject the INSERT outright.
	body := `{"from":"ada@acme-corp.dev","to":"hello@whiparc.com","subject":"Hi\r\nBcc: x@acme-corp.dev","text":"a\u0000b","html":"<p>x\u0000y</p>","messageId":"san-1"}`
	if w := postJSON(handleInboundEmail, "/api/inbound/email", body, inboundHeaders()); w.Code != http.StatusOK {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	var subject, text, html string
	if err := db.QueryRow("SELECT subject, text_body, html_body FROM inbound_emails WHERE message_id = 'san-1'").Scan(&subject, &text, &html); err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(subject, "\r\n") || strings.ContainsRune(text, 0) || strings.ContainsRune(html, 0) {
		t.Fatalf("unsanitized content stored: %q %q %q", subject, text, html)
	}
}

func TestInboundBodyLimit(t *testing.T) {
	setupCaptureTest(t)
	t.Setenv("INBOUND_EMAIL_SECRET", testInboundSecret)
	big := `{"from":"ada@acme-corp.dev","to":"hello@whiparc.com","text":"` + strings.Repeat("x", maxInboundBodyBytes+10) + `"}`
	if w := postJSON(handleInboundEmail, "/api/inbound/email", big, inboundHeaders()); w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized: got %d, want 413", w.Code)
	}
}
