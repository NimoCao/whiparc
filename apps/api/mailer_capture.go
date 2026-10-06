package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"mime"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// This file holds the EmailSender methods added for marketing-site email
// capture (newsletter double opt-in, contact form, inbound-mail
// notifications). They live apart from mailer.go on purpose: that file's
// per-provider methods are hand-assembled one email at a time, and these
// three share a template and a Resend/SMTP transport helper instead of each
// repeating it. The interface itself is still declared in mailer.go.

// InboxNotification is an internal notice to the site owner that a message
// arrived: either a contact-form submission or a forwarded inbound email.
// Every field is untrusted (it came from a stranger), so each transport
// sanitizes before use: header-bound fields lose CR/LF/NUL, HTML output is
// escaped, and the SMTP body is base64-encoded so it can never be read as
// headers.
type InboxNotification struct {
	Kind      string // "contact" or "inbound"
	FromName  string
	FromEmail string
	Subject   string
	Body      string
}

const (
	maxNotificationSubjectRunes = 150
	maxNotificationBodyRunes    = 20000
)

// cleanFreeText strips control characters other than newline and tab,
// normalizes line endings to \n and truncates to max runes. It is for
// message bodies, where newlines are legitimate (unlike
// sanitizeHeaderField, which is for single-line header values).
func cleanFreeText(s string, max int) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "�")
	}
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return truncateRunes(strings.TrimSpace(s), max)
}

// cleanSingleLine is cleanFreeText for header-bound values: no newlines or
// tabs at all.
func cleanSingleLine(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, strings.ToValidUTF8(s, "�"))
	return truncateRunes(strings.Join(strings.Fields(s), " "), max)
}

func truncateRunes(s string, max int) string {
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max])
}

func notificationSubject(n InboxNotification) string {
	switch n.Kind {
	case "inbound":
		subj := cleanSingleLine(n.Subject, maxNotificationSubjectRunes)
		if subj == "" {
			subj = "(no subject)"
		}
		return "[Whiparc inbound] " + subj
	default:
		who := cleanSingleLine(n.FromName, 80)
		if who == "" {
			who = cleanSingleLine(n.FromEmail, 80)
		}
		return "[Whiparc contact] " + who
	}
}

func notificationText(n InboxNotification) string {
	var b strings.Builder
	if n.Kind == "inbound" {
		b.WriteString("Inbound email received by the Whiparc API.\n\n")
	} else {
		b.WriteString("New message from the Whiparc contact form.\n\n")
	}
	if name := cleanSingleLine(n.FromName, 120); name != "" {
		fmt.Fprintf(&b, "From:    %s <%s>\n", name, cleanSingleLine(n.FromEmail, 254))
	} else {
		fmt.Fprintf(&b, "From:    %s\n", cleanSingleLine(n.FromEmail, 254))
	}
	if n.Kind == "inbound" {
		fmt.Fprintf(&b, "Subject: %s\n", cleanSingleLine(n.Subject, maxNotificationSubjectRunes))
	}
	b.WriteString("\n")
	b.WriteString(cleanFreeText(n.Body, maxNotificationBodyRunes))
	b.WriteString("\n\nReply to this email to answer the sender directly.\n")
	return b.String()
}

// ---------------------------------------------------------------------
// Console (local development)
// ---------------------------------------------------------------------

func (c *ConsoleMailer) SendNewsletterConfirmation(toEmail, confirmLink, unsubscribeLink string) error {
	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s\nSubject: Confirm your subscription to Whiparc updates\nAction Link: %s\nUnsubscribe Link: %s\nExpires: in 48 hours\n%s\n",
		divider, sanitizeHeaderField(toEmail), sanitizeHeaderField(confirmLink), sanitizeHeaderField(unsubscribeLink), divider)
	return nil
}

func (c *ConsoleMailer) SendContactAcknowledgement(toEmail, toName string) error {
	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s\nSubject: We got your message\nBody: Thanks %s, your message reached Whiparc.\n%s\n",
		divider, sanitizeHeaderField(toEmail), validateEmailContentName(toName), divider)
	return nil
}

func (c *ConsoleMailer) SendInboxNotification(toEmail string, n InboxNotification) error {
	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s\nReply-To: %s\nSubject: %s\n\n%s\n%s\n",
		divider, sanitizeHeaderField(toEmail), sanitizeHeaderField(n.FromEmail), notificationSubject(n), notificationText(n), divider)
	return nil
}

// ---------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------

// post sends one prepared Resend payload. Kept separate from the older
// methods in mailer.go, which each inline their own request.
func (r *ResendMailer) post(payload map[string]interface{}) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	endpoint := r.endpoint
	if endpoint == "" {
		endpoint = "https://api.resend.com/emails"
	}
	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(payloadJSON))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("resend api request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("resend returned status code %d", resp.StatusCode)
	}
	return nil
}

func (r *ResendMailer) SendNewsletterConfirmation(toEmail, confirmLink, unsubscribeLink string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanConfirm := sanitizeHeaderField(confirmLink)
	cleanUnsub := sanitizeHeaderField(unsubscribeLink)

	htmlBody := renderBrandedEmail(brandedEmail{
		Kicker:     "Updates / Confirm",
		Title:      "Confirm your subscription",
		Paragraphs: []string{"Thanks for your interest in Whiparc. Confirm your email address to receive occasional product updates. You will not be subscribed until you do."},
		CTALabel:   "Confirm subscription",
		CTALink:    cleanConfirm,
		Footer:     "If you did not ask for this, ignore this email and nothing will happen. This link expires in 48 hours.",
	})
	textBody := fmt.Sprintf("Thanks for your interest in Whiparc.\n\nConfirm your subscription to product updates by opening this link:\n%s\n\nIf you did not ask for this, ignore this email and you will not be subscribed. The link expires in 48 hours.\n\nUnsubscribe: %s\n", cleanConfirm, cleanUnsub)

	if err := r.post(map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanEmail},
		"subject": "Confirm your subscription to Whiparc updates",
		"html":    htmlBody,
		"text":    textBody,
		"headers": map[string]string{"List-Unsubscribe": "<" + cleanUnsub + ">"},
	}); err != nil {
		return err
	}
	log.Printf("[EMAIL] Newsletter confirmation sent to %s via Resend\n", cleanEmail)
	return nil
}

func (r *ResendMailer) SendContactAcknowledgement(toEmail, toName string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	greeting := validateEmailContentName(toName)

	htmlBody := renderBrandedEmail(brandedEmail{
		Kicker:     "Contact / Received",
		Title:      "We got your message",
		Paragraphs: []string{fmt.Sprintf("Hi %s, thanks for writing to Whiparc. Your message reached us and we will reply by email.", greeting)},
		Footer:     "This is an automatic acknowledgement. If you did not contact Whiparc, you can ignore it.",
	})
	textBody := fmt.Sprintf("Hi %s,\n\nThanks for writing to Whiparc. Your message reached us and we will reply by email.\n\nThis is an automatic acknowledgement. If you did not contact Whiparc, you can ignore it.\n", greeting)

	if err := r.post(map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanEmail},
		"subject": "We got your message",
		"html":    htmlBody,
		"text":    textBody,
	}); err != nil {
		return err
	}
	log.Printf("[EMAIL] Contact acknowledgement sent to %s via Resend\n", cleanEmail)
	return nil
}

func (r *ResendMailer) SendInboxNotification(toEmail string, n InboxNotification) error {
	cleanTo := sanitizeHeaderField(toEmail)

	// The notification body is plain text only. Rendering a stranger's
	// HTML in the owner's mail client is exactly the exposure this avoids.
	payload := map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanTo},
		"subject": notificationSubject(n),
		"text":    notificationText(n),
	}
	if replyTo := sanitizeHeaderField(n.FromEmail); safeEmailAddressPattern.MatchString(replyTo) {
		payload["reply_to"] = replyTo
	}
	if err := r.post(payload); err != nil {
		return err
	}
	log.Printf("[EMAIL] %s notification sent to %s via Resend\n", n.Kind, cleanTo)
	return nil
}

// ---------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------

// senderIdentity resolves the From header and envelope sender. EMAIL_FROM
// (SMTPMailer.from) may be a bare address or "Name <addr>"; if it does not
// parse, fall back to the same noreply address the older SMTP methods use.
func (s *SMTPMailer) senderIdentity() (header string, envelope string) {
	if parsed, err := mail.ParseAddress(s.from); err == nil && safeEmailAddressPattern.MatchString(parsed.Address) {
		return (&mail.Address{Name: parsed.Name, Address: parsed.Address}).String(), parsed.Address
	}
	return "Whiparc Team <noreply@whiparc.com>", "noreply@whiparc.com"
}

// SMTP messages in this file never contain request-derived text.
//
// CodeQL's go/email-injection rule has no sanitizers: any string that
// originates in an HTTP request and reaches the message written through
// smtp.Client.Data() is reported, however carefully it was cleaned. So the
// SMTP transport carries only constants and server-generated links; the
// recipient address is used solely in the SMTP envelope (RCPT TO), which is
// not part of the message. Anything that must show a visitor's name, address
// or message text (the owner notification) goes through the Resend transport,
// which posts JSON over HTTPS and is not a mail-content sink. See
// product-memory 11.1. TestSMTPMessagesNeverContainRequestText guards this.
//
// To is the RFC 5322 empty group because the real recipient is envelope-only.

// buildPlainMessage assembles a single-part UTF-8 text message. The body is
// base64-encoded and the header values are pre-sanitized, so nothing in the
// body can be interpreted as a header and nothing in a header can start a
// new one. Callers must pass only constant or server-generated subject and
// body text (see the note above).
func buildPlainMessage(fromHeader, subject, body string) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "From: %s\r\n", sanitizeHeaderField(fromHeader))
	b.WriteString("To: undisclosed-recipients:;\r\n")
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", sanitizeHeaderField(subject)))
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	fmt.Fprintf(&b, "Message-ID: <%s@whiparc.com>\r\n", generateRandomHex(16))
	b.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")

	encoded := base64.StdEncoding.EncodeToString([]byte(strings.ReplaceAll(body, "\n", "\r\n")))
	for len(encoded) > 76 {
		b.WriteString(encoded[:76])
		b.WriteString("\r\n")
		encoded = encoded[76:]
	}
	b.WriteString(encoded)
	b.WriteString("\r\n")
	return b.Bytes()
}

// sendPlain delivers a constant-text message. toEmail is validated and used
// only as the envelope recipient; subject and body must not be derived from
// request data.
func (s *SMTPMailer) sendPlain(toEmail, subject, body string) error {
	parsedTo, err := mail.ParseAddress(toEmail)
	if err != nil || !safeEmailAddressPattern.MatchString(parsedTo.Address) {
		return fmt.Errorf("invalid recipient address")
	}
	fromHeader, envelope := s.senderIdentity()
	msg := buildPlainMessage(fromHeader, subject, body)

	return s.sendMail(fmt.Sprintf("%s:%d", s.host, s.port), s.plainAuth(), envelope, []string{parsedTo.Address}, msg)
}

func (s *SMTPMailer) plainAuth() smtp.Auth {
	if s.user == "" {
		return nil
	}
	return smtp.PlainAuth("", s.user, s.pass, s.host)
}

func (s *SMTPMailer) SendNewsletterConfirmation(toEmail, confirmLink, unsubscribeLink string) error {
	confirmURL, err := url.ParseRequestURI(confirmLink)
	if err != nil {
		return fmt.Errorf("invalid confirmation link: %w", err)
	}
	unsubURL, err := url.ParseRequestURI(unsubscribeLink)
	if err != nil {
		return fmt.Errorf("invalid unsubscribe link: %w", err)
	}
	body := fmt.Sprintf("Thanks for your interest in Whiparc.\n\nConfirm your subscription to product updates by opening this link:\n%s\n\nIf you did not ask for this, ignore this email and you will not be subscribed. The link expires in 48 hours.\n\nUnsubscribe: %s\n",
		validateEmailContentLink(confirmURL.String()), validateEmailContentLink(unsubURL.String()))
	return s.sendPlain(toEmail, "Confirm your subscription to Whiparc updates", body)
}

// SendContactAcknowledgement over SMTP uses a generic greeting: the sender's
// name is request data and stays out of the message (see the note above).
func (s *SMTPMailer) SendContactAcknowledgement(toEmail, _ string) error {
	const body = "Hi,\n\nThanks for writing to Whiparc. Your message reached us and we will reply by email.\n\nThis is an automatic acknowledgement. If you did not contact Whiparc, you can ignore it.\n"
	return s.sendPlain(toEmail, "We got your message", body)
}

// SendInboxNotification over SMTP is a content-free alert: it says that a
// message arrived and where it is stored, but not who sent it or what it
// said, because that text is request data (see the note above). Use the
// Resend transport (RESEND_API_KEY) to receive the full message by email.
func (s *SMTPMailer) SendInboxNotification(toEmail string, n InboxNotification) error {
	subject := "[Whiparc] New contact message received"
	body := "A new message arrived through the Whiparc contact form.\n\nIt is stored in the contact_messages table. The sender and text are not forwarded over SMTP; configure RESEND_API_KEY to receive the full message by email.\n"
	if n.Kind == "inbound" {
		subject = "[Whiparc] New inbound email received"
		body = "A new email arrived at the Whiparc inbound webhook.\n\nIt is stored in the inbound_emails table. The sender, subject and text are not forwarded over SMTP; configure RESEND_API_KEY to receive the full message by email.\n"
	}
	return s.sendPlain(toEmail, subject, body)
}
