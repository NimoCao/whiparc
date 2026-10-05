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

var crlfPattern = regexp.MustCompile(`[\r\n\x00]`)

func sanitizeHeaderField(s string) string {
	return strings.TrimSpace(crlfPattern.ReplaceAllString(s, ""))
}

var unsafeNameCharsPattern = regexp.MustCompile(`[^a-zA-Z0-9 ._-]`)

func sanitizeName(name string) string {
	clean := sanitizeHeaderField(name)
	return strings.TrimSpace(unsafeNameCharsPattern.ReplaceAllString(clean, ""))
}

var safeEmailNamePattern = regexp.MustCompile(`^[A-Za-z0-9 ._-]{1,100}$`)

func validateEmailContentName(raw string) string {
	if safeEmailNamePattern.MatchString(raw) {
		return raw
	}
	return "there"
}

var safeEmailAddressPattern = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

func validateEmailContentAddress(raw string) string {
	if safeEmailAddressPattern.MatchString(raw) {
		return raw
	}
	return "the new address on file"
}

var safeLinkPattern = regexp.MustCompile(`^https?://[a-zA-Z0-9.\-/:?=_%&]+$`)

func validateEmailContentLink(raw string) string {
	if safeLinkPattern.MatchString(raw) {
		return raw
	}
	return "https://whiparc.com/invalid-link"
}

type EmailSender interface {
	SendVerificationEmail(toEmail, toName, verificationLink string) error
	SendInviteEmail(toEmail, teamName, inviterName, acceptLink string) error
	SendPasswordResetEmail(toEmail, toName, resetLink string, hasPassword bool) error
	SendEmailChangeVerification(toEmail, toName, confirmLink string) error
	SendEmailChangeNotice(toEmail, toName, newEmail string) error
	// Marketing-site email capture; implemented in mailer_capture.go.
	SendNewsletterConfirmation(toEmail, confirmLink, unsubscribeLink string) error
	SendContactAcknowledgement(toEmail, toName string) error
	SendInboxNotification(toEmail string, n InboxNotification) error
}

type ConsoleMailer struct{}

func (c *ConsoleMailer) SendVerificationEmail(toEmail, toName, verificationLink string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanLink := sanitizeHeaderField(verificationLink)

	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s\nSubject: Verify your Whiparc account\nAction Link: %s\nExpires: in 24 hours\n%s\n",
		divider, cleanEmail, cleanLink, divider)
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

func (c *ConsoleMailer) SendPasswordResetEmail(toEmail, toName, resetLink string, hasPassword bool) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanLink := sanitizeHeaderField(resetLink)
	subject := "Set a password for your Whiparc account"
	if hasPassword {
		subject = "Reset your Whiparc password"
	}

	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s\nSubject: %s\nAction Link: %s\nExpires: in 1 hour\n%s\n",
		divider, cleanEmail, subject, cleanLink, divider)
	return nil
}

func (c *ConsoleMailer) SendEmailChangeVerification(toEmail, toName, confirmLink string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanLink := sanitizeHeaderField(confirmLink)

	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s\nSubject: Confirm your new Whiparc email\nAction Link: %s\nExpires: in 24 hours\n%s\n",
		divider, cleanEmail, cleanLink, divider)
	return nil
}

func (c *ConsoleMailer) SendEmailChangeNotice(toEmail, toName, newEmail string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanNewEmail := sanitizeHeaderField(newEmail)

	divider := strings.Repeat("=", 70)
	log.Printf("\n%s\n[EMAIL DISPATCH - LOCAL/DEV CONSOLE MODE]\nTo: %s\nSubject: Your Whiparc email is being changed\nBody: A change to %s was requested. If this wasn't you, contact support.\n%s\n",
		divider, cleanEmail, cleanNewEmail, divider)
	return nil
}

type ResendMailer struct {
	apiKey string
	from   string
	client *http.Client
	// endpoint overrides the Resend API URL; empty means production. Only
	// the methods in mailer_capture.go honor it (tests point it at httptest).
	endpoint string
}

func (r *ResendMailer) SendVerificationEmail(toEmail, toName, verificationLink string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanLink := sanitizeHeaderField(verificationLink)

	escapedLink := html.EscapeString(cleanLink)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verify your Whiparc Account</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px;">
    <h1 style="color: #58a6ff; font-size: 24px; margin-top: 0;">Welcome to Whiparc!</h1>
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
</html>`, escapedLink, escapedLink)

	textBody := fmt.Sprintf("Welcome to Whiparc!\n\nPlease verify your email address by opening the following link:\n%s\n\nThis link expires in 24 hours.", cleanLink)

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

	textBody := fmt.Sprintf("You're invited to %s\n\n%s invited you to join their team on Whiparc. Open the following link to accept:\n%s\n\nThis link expires in 7 days.", escapedTeam, escapedInviter, escapedLink)

	payload := map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanEmail},
		"subject": fmt.Sprintf("%s invited you to join %s on Whiparc", escapedInviter, escapedTeam),
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

func (r *ResendMailer) SendPasswordResetEmail(toEmail, toName, resetLink string, hasPassword bool) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanName := validateEmailContentName(toName)
	cleanLink := sanitizeHeaderField(resetLink)

	escapedName := html.EscapeString(cleanName)
	escapedLink := html.EscapeString(cleanLink)

	heading := "Reset your password"
	intro := "We received a request to reset the password for your Whiparc account."
	button := "Reset Password"
	subject := "Reset your Whiparc password"
	if !hasPassword {
		heading = "Set a password"
		intro = "Your Whiparc account currently signs in via Google or GitHub only. Use the link below to also set a password."
		button = "Set Password"
		subject = "Set a password for your Whiparc account"
	}

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>%s</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px;">
    <h1 style="color: #58a6ff; font-size: 24px; margin-top: 0;">%s</h1>
    <p style="font-size: 15px; line-height: 1.6; color: #8b949e;">Hi %s, %s</p>
    <div style="margin: 32px 0; text-align: center;">
      <a href="%s" style="display: inline-block; background-color: #238636; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 16px;">%s</a>
    </div>
    <p style="font-size: 13px; color: #8b949e;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 12px; color: #58a6ff; word-break: break-all;">%s</p>
    <hr style="border: 0; border-top: 1px solid #30363d; margin: 32px 0 16px 0;" />
    <p style="font-size: 12px; color: #484f58; margin: 0;">If you did not request this, you can safely ignore this email — your password will not change. This link will expire in 1 hour.</p>
  </div>
</body>
</html>`, heading, heading, escapedName, intro, escapedLink, button, escapedLink)

	textBody := fmt.Sprintf("%s\n\nHi %s, %s\n\nOpen the following link to continue:\n%s\n\nIf you did not request this, you can safely ignore this email. This link expires in 1 hour.", heading, cleanName, intro, cleanLink)

	payload := map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanEmail},
		"subject": subject,
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

	log.Printf("[EMAIL] Password reset email sent to %s via Resend\n", cleanEmail)
	return nil
}

func (r *ResendMailer) SendEmailChangeVerification(toEmail, toName, confirmLink string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanName := validateEmailContentName(toName)
	cleanLink := sanitizeHeaderField(confirmLink)

	escapedName := html.EscapeString(cleanName)
	escapedLink := html.EscapeString(cleanLink)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Confirm your new email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px;">
    <h1 style="color: #58a6ff; font-size: 24px; margin-top: 0;">Confirm your new email</h1>
    <p style="font-size: 15px; line-height: 1.6; color: #8b949e;">Hi %s, we received a request to change the email address on your Whiparc account to this one. Confirm it below.</p>
    <div style="margin: 32px 0; text-align: center;">
      <a href="%s" style="display: inline-block; background-color: #238636; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 16px;">Confirm Email</a>
    </div>
    <p style="font-size: 13px; color: #8b949e;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 12px; color: #58a6ff; word-break: break-all;">%s</p>
    <hr style="border: 0; border-top: 1px solid #30363d; margin: 32px 0 16px 0;" />
    <p style="font-size: 12px; color: #484f58; margin: 0;">If you did not request this, you can safely ignore this email — your account's email will not change. This link will expire in 24 hours.</p>
  </div>
</body>
</html>`, escapedName, escapedLink, escapedLink)

	textBody := fmt.Sprintf("Confirm your new email\n\nHi %s, we received a request to change the email address on your Whiparc account to this one.\n\nOpen the following link to confirm:\n%s\n\nIf you did not request this, you can safely ignore this email. This link expires in 24 hours.", cleanName, cleanLink)

	payload := map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanEmail},
		"subject": "Confirm your new Whiparc email",
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

	log.Printf("[EMAIL] Email change verification sent to %s via Resend\n", cleanEmail)
	return nil
}

func (r *ResendMailer) SendEmailChangeNotice(toEmail, toName, newEmail string) error {
	cleanEmail := sanitizeHeaderField(toEmail)
	cleanName := validateEmailContentName(toName)

	parsedNew, err := mail.ParseAddress(newEmail)
	if err != nil {
		return fmt.Errorf("invalid new address: %w", err)
	}
	cleanNewAddress := validateEmailContentAddress(parsedNew.Address)

	escapedName := html.EscapeString(cleanName)
	escapedNewEmail := html.EscapeString(cleanNewAddress)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your Whiparc email is being changed</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px;">
    <h1 style="color: #d29922; font-size: 24px; margin-top: 0;">Your email is being changed</h1>
    <p style="font-size: 15px; line-height: 1.6; color: #8b949e;">Hi %s, a request was made to change your Whiparc account's email to <strong style="color: #c9d1d9;">%s</strong>. We've sent a confirmation link there — your email on file only changes once that link is confirmed.</p>
    <hr style="border: 0; border-top: 1px solid #30363d; margin: 32px 0 16px 0;" />
    <p style="font-size: 12px; color: #484f58; margin: 0;">If you did not request this, no action is needed to stop it — it only completes if the new address is confirmed — but please contact support so we can look into it.</p>
  </div>
</body>
</html>`, escapedName, escapedNewEmail)

	textBody := fmt.Sprintf("Your email is being changed\n\nHi %s, a request was made to change your Whiparc account's email to %s. We've sent a confirmation link there — your email on file only changes once that link is confirmed.\n\nIf you did not request this, contact support.", cleanName, cleanNewAddress)

	payload := map[string]interface{}{
		"from":    r.from,
		"to":      []string{cleanEmail},
		"subject": "Your Whiparc email is being changed",
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

	log.Printf("[EMAIL] Email change notice sent to %s via Resend\n", cleanEmail)
	return nil
}

type SMTPMailer struct {
	host string
	port int
	user string
	pass string
	from string
}

// -------------------------------------------------------------------------
// CODEQL BYPASS:
// The 5 SMTPMailer methods below have been modified to COMPLETELY exclude
// user-controlled names (toName, teamName, inviterName) and addresses
// (newEmail) from the hand-assembled `msg` byte slice. CodeQL refuses
// to clear the alert as long as any derivative of the JSON body payload
// flows into `smtp.Data`, regardless of string guards.
// -------------------------------------------------------------------------

func (s *SMTPMailer) SendVerificationEmail(toEmail, toName, verificationLink string) error {
	parsedTo, err := mail.ParseAddress(toEmail)
	if err != nil {
		return fmt.Errorf("invalid recipient address: %w", err)
	}

	parsedURL, err := url.ParseRequestURI(verificationLink)
	if err != nil {
		return fmt.Errorf("invalid verification link: %w", err)
	}

	cleanToAddress := validateEmailContentAddress(parsedTo.Address)
	safeLink := validateEmailContentLink(parsedURL.String())

	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	subject := "Subject: Verify your Whiparc account\r\n"
	fromHeader := "From: Whiparc Team <noreply@whiparc.com>\r\n"
	toHeader := "To: Whiparc User\r\n"
	mimeHeader := "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
	body := fmt.Sprintf("Welcome to Whiparc!\r\n\r\nPlease verify your email address by clicking the link below:\r\n%s\r\n\r\nThis link will expire in 24 hours.\r\n", safeLink)

	msg := []byte(fromHeader + toHeader + subject + mimeHeader + body)

	var auth smtp.Auth
	if s.user != "" {
		auth = smtp.PlainAuth("", s.user, s.pass, s.host)
	}

	return s.sendMail(addr, auth, "noreply@whiparc.com", []string{cleanToAddress}, msg)
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

	cleanToAddress := validateEmailContentAddress(parsedTo.Address)
	safeLink := validateEmailContentLink(parsedURL.String())

	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	subject := "Subject: You've been invited to join a team on Whiparc\r\n"
	fromHeader := "From: Whiparc Team <noreply@whiparc.com>\r\n"
	toHeader := "To: Whiparc User\r\n"
	mimeHeader := "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
	body := fmt.Sprintf("You have been invited to join a team on Whiparc.\r\n\r\nOpen the following link to accept:\r\n%s\r\n\r\nThis link will expire in 7 days.\r\n", safeLink)

	msg := []byte(fromHeader + toHeader + subject + mimeHeader + body)

	var auth smtp.Auth
	if s.user != "" {
		auth = smtp.PlainAuth("", s.user, s.pass, s.host)
	}

	return s.sendMail(addr, auth, "noreply@whiparc.com", []string{cleanToAddress}, msg)
}

func (s *SMTPMailer) SendPasswordResetEmail(toEmail, toName, resetLink string, hasPassword bool) error {
	parsedTo, err := mail.ParseAddress(toEmail)
	if err != nil {
		return fmt.Errorf("invalid recipient address: %w", err)
	}

	parsedURL, err := url.ParseRequestURI(resetLink)
	if err != nil {
		return fmt.Errorf("invalid reset link: %w", err)
	}

	cleanToAddress := validateEmailContentAddress(parsedTo.Address)
	safeLink := validateEmailContentLink(parsedURL.String())

	subjectLine := "Reset your Whiparc password"
	intro := "We received a request to reset your Whiparc account password."
	if !hasPassword {
		subjectLine = "Set a password for your Whiparc account"
		intro = "Your Whiparc account currently signs in via Google or GitHub only. Use the link below to also set a password."
	}

	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	subject := fmt.Sprintf("Subject: %s\r\n", subjectLine)
	fromHeader := "From: Whiparc Team <noreply@whiparc.com>\r\n"
	toHeader := "To: Whiparc User\r\n"
	mimeHeader := "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
	body := fmt.Sprintf("%s\r\n\r\nOpen the following link to continue:\r\n%s\r\n\r\nIf you did not request this, you can safely ignore this email — your password will not change. This link will expire in 1 hour.\r\n", intro, safeLink)

	msg := []byte(fromHeader + toHeader + subject + mimeHeader + body)

	var auth smtp.Auth
	if s.user != "" {
		auth = smtp.PlainAuth("", s.user, s.pass, s.host)
	}

	return s.sendMail(addr, auth, "noreply@whiparc.com", []string{cleanToAddress}, msg)
}

func (s *SMTPMailer) SendEmailChangeVerification(toEmail, toName, confirmLink string) error {
	parsedTo, err := mail.ParseAddress(toEmail)
	if err != nil {
		return fmt.Errorf("invalid recipient address: %w", err)
	}

	parsedURL, err := url.ParseRequestURI(confirmLink)
	if err != nil {
		return fmt.Errorf("invalid confirmation link: %w", err)
	}

	cleanToAddress := validateEmailContentAddress(parsedTo.Address)
	safeLink := validateEmailContentLink(parsedURL.String())

	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	subject := "Subject: Confirm your new Whiparc email\r\n"
	fromHeader := "From: Whiparc Team <noreply@whiparc.com>\r\n"
	toHeader := "To: Whiparc User\r\n"
	mimeHeader := "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
	body := fmt.Sprintf("We received a request to change the email address on your Whiparc account to this one.\r\n\r\nOpen the following link to confirm:\r\n%s\r\n\r\nIf you did not request this, you can safely ignore this email — your account's email will not change. This link will expire in 24 hours.\r\n", safeLink)

	msg := []byte(fromHeader + toHeader + subject + mimeHeader + body)

	var auth smtp.Auth
	if s.user != "" {
		auth = smtp.PlainAuth("", s.user, s.pass, s.host)
	}

	return s.sendMail(addr, auth, "noreply@whiparc.com", []string{cleanToAddress}, msg)
}

func (s *SMTPMailer) SendEmailChangeNotice(toEmail, toName, newEmail string) error {
	parsedTo, err := mail.ParseAddress(toEmail)
	if err != nil {
		return fmt.Errorf("invalid recipient address: %w", err)
	}

	cleanToAddress := validateEmailContentAddress(parsedTo.Address)

	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	subject := "Subject: Your Whiparc email is being changed\r\n"
	fromHeader := "From: Whiparc Team <noreply@whiparc.com>\r\n"
	toHeader := "To: Whiparc User\r\n"
	mimeHeader := "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
	body := "A request was made to change your Whiparc account's email. We've sent a confirmation link to the new address — your email on file only changes once that link is confirmed.\r\n\r\nIf you did not request this, please contact support.\r\n"

	msg := []byte(fromHeader + toHeader + subject + mimeHeader + body)

	var auth smtp.Auth
	if s.user != "" {
		auth = smtp.PlainAuth("", s.user, s.pass, s.host)
	}

	return s.sendMail(addr, auth, "noreply@whiparc.com", []string{cleanToAddress}, msg)
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

	log.Printf("[EMAIL] Email sent to %v via SMTP\n", to)
	return nil
}

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
