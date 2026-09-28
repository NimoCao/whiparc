package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// crlfPattern strips CR, LF, and null bytes — the characters that matter for
// SMTP header/command injection (CWE-640) and for prematurely terminating
// the DATA section (a lone "." on its own line). Every string interpolated
// into a raw SMTP header or message body in this file is passed through
// sanitizeHeaderField or sanitizeName first.
var crlfPattern = regexp.MustCompile(`[\r\n\x00]`)

// sanitizeHeaderField removes CR, LF, and null characters to prevent SMTP header injection (CWE-640).
func sanitizeHeaderField(s string) string {
	return strings.TrimSpace(crlfPattern.ReplaceAllString(s, ""))
}

// unsafeNameCharsPattern is the inverse of sanitizeName's allowlist (letters,
// digits, spaces, dots, dashes, underscores) — anything not in the allowlist
// is stripped, so the result can never contain CR/LF or other characters
// that would let a user-controlled name (an account name, a team name)
// manipulate the raw SMTP message this package hand-assembles.
var unsafeNameCharsPattern = regexp.MustCompile(`[^a-zA-Z0-9 ._-]`)

// sanitizeName filters a recipient name to an allowlist of safe characters (letters, digits, spaces, dots, dashes, underscores).
func sanitizeName(name string) string {
	clean := sanitizeHeaderField(name)
	return strings.TrimSpace(unsafeNameCharsPattern.ReplaceAllString(clean, ""))
}

// EmailSender defines the interface for delivering outbound transactional emails.
type EmailSender interface {
	SendVerificationEmail(toEmail, toName, verificationLink string) error
	SendInviteEmail(toEmail, teamName, inviterName, acceptLink string) error
}

// ConsoleMailer logs transactional emails directly to the server logs for local development.
type ConsoleMailer struct{}

func (c *ConsoleMailer) SendVerificationEmail(toEmail, toName, verificationLink string) error {
	cleanName := sanitizeName(toName)
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanLink := sanitizeHeaderField(verificationLink)

	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s <%s>\nSubject: Verify your Whiparc account\nAction Link: %s\nExpires: in 24 hours\n%s\n",
		divider, cleanName, cleanEmail, cleanLink, divider)
	return nil
}

func (c *ConsoleMailer) SendInviteEmail(toEmail, teamName, inviterName, acceptLink string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanTeam := sanitizeHeaderField(teamName)
	cleanInviter := sanitizeName(inviterName)
	cleanLink := sanitizeHeaderField(acceptLink)

	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s\nSubject: %s invited you to join %s on Whiparc\nAction Link: %s\nExpires: in 7 days\n%s\n",
		divider, cleanEmail, cleanInviter, cleanTeam, cleanLink, divider)
	return nil
}

// ResendMailer sends emails via the Resend REST API (https://resend.com).
type ResendMailer struct {
	apiKey string
	from   string
	client *http.Client
}

func (r *ResendMailer) SendVerificationEmail(toEmail, toName, verificationLink string) error {
	cleanName := sanitizeName(toName)
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanLink := sanitizeHeaderField(verificationLink)

	escapedName := html.EscapeString(cleanName)
	escapedLink := html.EscapeString(cleanLink)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verify your Whiparc Account</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px;">
    <h1 style="color: #58a6ff; font-size: 24px; margin-top: 0;">Welcome to Whiparc, %s!</h1>
    <p style="font-size: 15px; line-height: 1.6; color: #8b949e;">Please verify your email address to activate your account and start orchestrating your cloud infrastructure.</p>
    <div style="margin: 32px 0; text-align: center;">
      <a href="%s" style="display: inline-block; background-color: #238636; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 16px;">Verify Email Address</a>
    </div>
    <p style="font-size: 13px; color: #8b949e;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 12px; color: #58a6ff; word-break: break-all;">%s</p>
    <hr style="border: 0; border-top: 1px solid #30363d; margin: 32px 0 16px 0;" />
    <p style="font-size: 12px; color: #484f58; margin: 0;">If you did not sign up for Whiparc, please disregard this email. This link will expire in 24 hours.</p>
  </div>
</body>
</html>`, escapedName, escapedLink, escapedLink)

	textBody := fmt.Sprintf("Welcome to Whiparc, %s!\n\nPlease verify your email address by opening the following link:\n%s\n\nThis link expires in 24 hours.", cleanName, cleanLink)

	payload := map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanEmail},
		"subject": "Verify your Whiparc account",
		"html":    htmlBody,
		"text":    textBody,
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewReader(payloadJSON))
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

	log.Printf("[EMAIL] Verification email sent to %s via Resend\n", cleanEmail)
	return nil
}

func (r *ResendMailer) SendInviteEmail(toEmail, teamName, inviterName, acceptLink string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanTeam := sanitizeName(teamName)
	cleanInviter := sanitizeName(inviterName)
	cleanLink := sanitizeHeaderField(acceptLink)

	escapedTeam := html.EscapeString(cleanTeam)
	escapedInviter := html.EscapeString(cleanInviter)
	escapedLink := html.EscapeString(cleanLink)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>You've been invited to Whiparc</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px;">
    <h1 style="color: #58a6ff; font-size: 24px; margin-top: 0;">You're invited to %s</h1>
    <p style="font-size: 15px; line-height: 1.6; color: #8b949e;">%s invited you to join their team on Whiparc.</p>
    <div style="margin: 32px 0; text-align: center;">
      <a href="%s" style="display: inline-block; background-color: #238636; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 16px;">Accept Invite</a>
    </div>
    <p style="font-size: 13px; color: #8b949e;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 12px; color: #58a6ff; word-break: break-all;">%s</p>
    <hr style="border: 0; border-top: 1px solid #30363d; margin: 32px 0 16px 0;" />
    <p style="font-size: 12px; color: #484f58; margin: 0;">If you weren't expecting this invite, you can safely ignore this email. This link will expire in 7 days.</p>
  </div>
</body>
</html>`, escapedTeam, escapedInviter, escapedLink, escapedLink)

	textBody := fmt.Sprintf("You're invited to %s\n\n%s invited you to join their team on Whiparc. Open the following link to accept:\n%s\n\nThis link expires in 7 days.", cleanTeam, cleanInviter, cleanLink)

	payload := map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanEmail},
		"subject": fmt.Sprintf("%s invited you to join %s on Whiparc", cleanInviter, cleanTeam),
		"html":    htmlBody,
		"text":    textBody,
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewReader(payloadJSON))
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

	log.Printf("[EMAIL] Invite email sent to %s via Resend\n", cleanEmail)
	return nil
}

// SMTPMailer sends emails via standard SMTP server.
type SMTPMailer struct {
	host string
	port int
	user string
	pass string
	from string
}

func (s *SMTPMailer) SendVerificationEmail(toEmail, toName, verificationLink string) error {
	// Strictly parse and validate destination email address (RFC 5322)
	parsedTo, err := mail.ParseAddress(toEmail)
	if err != nil {
		return fmt.Errorf("invalid recipient address: %w", err)
	}

	// Strictly parse and validate verification URL
	parsedURL, err := url.ParseRequestURI(verificationLink)
	if err != nil {
		return fmt.Errorf("invalid verification link: %w", err)
	}
	safeLink := parsedURL.String()

	cleanName := sanitizeName(toName)
	cleanFrom := sanitizeHeaderField(s.from)
	if cleanFrom == "" {
		cleanFrom = "noreply@whiparc.com"
	}

	fromAddress := cleanFrom
	if fromParsed, err := mail.ParseAddress(cleanFrom); err == nil {
		fromAddress = fromParsed.String()
	}

	toAddress := (&mail.Address{Name: cleanName, Address: parsedTo.Address}).String()

	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	subject := "Subject: Verify your Whiparc account\r\n"
	fromHeader := fmt.Sprintf("From: %s\r\n", fromAddress)
	toHeader := fmt.Sprintf("To: %s\r\n", toAddress)
	mimeHeader := "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
	body := fmt.Sprintf("Welcome to Whiparc, %s!\r\n\r\nPlease verify your email address by clicking the link below:\r\n%s\r\n\r\nThis link will expire in 24 hours.\r\n", cleanName, safeLink)

	msg := []byte(fromHeader + toHeader + subject + mimeHeader + body)

	var auth smtp.Auth
	if s.user != "" {
		auth = smtp.PlainAuth("", s.user, s.pass, s.host)
	}

	fromEnvelope := cleanFrom
	if fromParsed, err := mail.ParseAddress(cleanFrom); err == nil && fromParsed.Address != "" {
		fromEnvelope = fromParsed.Address
	}

	return s.sendMail(addr, auth, fromEnvelope, []string{parsedTo.Address}, msg)
}

func (s *SMTPMailer) SendInviteEmail(toEmail, teamName, inviterName, acceptLink string) error {
	parsedTo, err := mail.ParseAddress(toEmail)
	if err != nil {
		return fmt.Errorf("invalid recipient address: %w", err)
	}

	parsedURL, err := url.ParseRequestURI(acceptLink)
	if err != nil {
		return fmt.Errorf("invalid invite link: %w", err)
	}
	safeLink := parsedURL.String()

	cleanTeam := sanitizeName(teamName)
	cleanInviter := sanitizeName(inviterName)
	cleanFrom := sanitizeHeaderField(s.from)
	if cleanFrom == "" {
		cleanFrom = "noreply@whiparc.com"
	}

	fromAddress := cleanFrom
	if fromParsed, err := mail.ParseAddress(cleanFrom); err == nil {
		fromAddress = fromParsed.String()
	}

	toAddress := parsedTo.String()

	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	subject := fmt.Sprintf("Subject: %s invited you to join %s on Whiparc\r\n", cleanInviter, cleanTeam)
	fromHeader := fmt.Sprintf("From: %s\r\n", fromAddress)
	toHeader := fmt.Sprintf("To: %s\r\n", toAddress)
	mimeHeader := "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
	body := fmt.Sprintf("%s invited you to join %s on Whiparc.\r\n\r\nOpen the following link to accept:\r\n%s\r\n\r\nThis link will expire in 7 days.\r\n", cleanInviter, cleanTeam, safeLink)

	msg := []byte(fromHeader + toHeader + subject + mimeHeader + body)

	var auth smtp.Auth
	if s.user != "" {
		auth = smtp.PlainAuth("", s.user, s.pass, s.host)
	}

	fromEnvelope := cleanFrom
	if fromParsed, err := mail.ParseAddress(cleanFrom); err == nil && fromParsed.Address != "" {
		fromEnvelope = fromParsed.Address
	}

	return s.sendMail(addr, auth, fromEnvelope, []string{parsedTo.Address}, msg)
}

func (s *SMTPMailer) sendMail(addr string, auth smtp.Auth, from string, to []string, msg []byte) error {
	client, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("smtp dial failed: %w", err)
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		tlsConfig := &tls.Config{ServerName: s.host}
		if err := client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("smtp starttls failed: %w", err)
		}
	}

	if auth != nil {
		if ok, _ := client.Extension("AUTH"); ok {
			if err := client.Auth(auth); err != nil {
				return fmt.Errorf("smtp auth failed: %w", err)
			}
		}
	}

	if err := client.Mail(from); err != nil {
		return fmt.Errorf("smtp mail command failed: %w", err)
	}

	for _, recipient := range to {
		if err := client.Rcpt(recipient); err != nil {
			return fmt.Errorf("smtp rcpt command failed: %w", err)
		}
	}

	wc, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data command failed: %w", err)
	}

	if _, err := wc.Write(msg); err != nil {
		_ = wc.Close()
		return fmt.Errorf("smtp write message failed: %w", err)
	}

	if err := wc.Close(); err != nil {
		return fmt.Errorf("smtp close data failed: %w", err)
	}

	if err := client.Quit(); err != nil {
		log.Printf("[EMAIL] Warning: smtp quit returned error: %v\n", err)
	}

	log.Printf("[EMAIL] Verification email sent to %v via SMTP\n", to)
	return nil
}

// NewEmailSender constructs an EmailSender based on environment configuration.
func NewEmailSender() EmailSender {
	if apiKey := os.Getenv("RESEND_API_KEY"); apiKey != "" {
		from := os.Getenv("EMAIL_FROM")
		if from == "" {
			from = "Whiparc <noreply@whiparc.com>"
		}
		log.Println("[EMAIL] Initialized Resend mailer")
		return &ResendMailer{
			apiKey: apiKey,
			from:   from,
			client: &http.Client{Timeout: 10 * time.Second},
		}
	}

	if smtpHost := os.Getenv("SMTP_HOST"); smtpHost != "" {
		port := 587
		if pStr := os.Getenv("SMTP_PORT"); pStr != "" {
			if p, err := strconv.Atoi(pStr); err == nil {
				port = p
			}
		}
		from := os.Getenv("EMAIL_FROM")
		if from == "" {
			from = os.Getenv("SMTP_USER")
		}
		log.Printf("[EMAIL] Initialized SMTP mailer on %s:%d\n", smtpHost, port)
		return &SMTPMailer{
			host: smtpHost,
			port: port,
			user: os.Getenv("SMTP_USER"),
			pass: os.Getenv("SMTP_PASS"),
			from: from,
		}
	}

	log.Println("[EMAIL] No SMTP or Resend credentials configured — using ConsoleMailer (verification links printed to stdout)")
	return &ConsoleMailer{}
}
