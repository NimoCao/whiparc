package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"
)

// Inbound mail. The hosted mailbox / email provider is not fixed yet, so the
// API does not speak any one provider's webhook dialect. It accepts a small
// normalized JSON shape and tolerates the field names the common providers
// use for the same things (see parseInboundEmail). Whatever service ends up
// hosting the mailbox only has to POST each received message here, with the
// shared secret, to have it archived and forwarded.
//
// Nothing in this file renders the message. html_body is stored for a future
// admin viewer, which must sanitize it: it is attacker-controlled markup.

const (
	maxInboundBodyBytes   = 2 << 20
	maxInboundTextRunes   = 200000
	maxInboundHTMLRunes   = 500000
	maxInboundSubjectRune = 500
)

type inboundMessage struct {
	MessageID string
	FromName  string
	FromEmail string
	ToEmail   string
	Subject   string
	Text      string
	HTML      string
}

func lowerKeys(m map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[strings.ToLower(k)] = v
	}
	return out
}

func firstString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

// addressFrom pulls one (name, email) pair out of the shapes providers use
// for an address: "Name <a@b.com>", a list of those, "a@b.com, c@d.com", or
// an object like {"email": "...", "name": "..."}. Only the first address is
// used.
func addressFrom(v interface{}) (name, email string) {
	switch t := v.(type) {
	case string:
		if list, err := mail.ParseAddressList(t); err == nil && len(list) > 0 {
			return list[0].Name, strings.ToLower(list[0].Address)
		}
		if a, err := mail.ParseAddress(t); err == nil {
			return a.Name, strings.ToLower(a.Address)
		}
	case []interface{}:
		if len(t) > 0 {
			return addressFrom(t[0])
		}
	case map[string]interface{}:
		m := lowerKeys(t)
		addr := firstString(m, "email", "address", "emailaddress")
		return firstString(m, "name", "fullname"), strings.ToLower(strings.TrimSpace(addr))
	}
	return "", ""
}

func firstAddress(m map[string]interface{}, keys ...string) (string, string) {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			if name, email := addressFrom(v); email != "" {
				return name, email
			}
		}
	}
	return "", ""
}

// parseInboundEmail accepts:
//   - the normalized shape: from, to, subject, text, html, messageId
//   - Postmark's inbound JSON: From/FromFull, To, Subject, TextBody,
//     HtmlBody, MessageID
//   - the same fields nested under a top-level "data" object, which is how
//     several providers envelope an event
//
// Keys are matched case-insensitively. It does not validate that the
// message is genuine; the shared-secret check in the handler does that.
func parseInboundEmail(raw []byte) (inboundMessage, error) {
	var top map[string]interface{}
	if err := json.Unmarshal(raw, &top); err != nil {
		return inboundMessage{}, err
	}
	src := lowerKeys(top)
	if data, ok := src["data"].(map[string]interface{}); ok {
		src = lowerKeys(data)
	}

	var msg inboundMessage
	msg.FromName, msg.FromEmail = firstAddress(src, "from", "fromfull", "sender", "from_email")
	_, msg.ToEmail = firstAddress(src, "to", "recipient", "to_email")
	msg.Subject = cleanSingleLine(firstString(src, "subject"), maxInboundSubjectRune)
	msg.Text = cleanFreeText(firstString(src, "text", "textbody", "text_body", "plain", "body-plain", "body_plain"), maxInboundTextRunes)
	msg.HTML = truncateRunes(strings.ReplaceAll(strings.ToValidUTF8(firstString(src, "html", "htmlbody", "html_body", "body-html", "body_html"), "�"), "\x00", ""), maxInboundHTMLRunes)
	msg.MessageID = cleanSingleLine(firstString(src, "messageid", "message_id", "message-id", "email_id", "emailid", "id"), 255)
	msg.FromName = cleanSingleLine(msg.FromName, 120)

	if !safeEmailAddressPattern.MatchString(msg.FromEmail) {
		return inboundMessage{}, errMissingField("sender address")
	}
	if !safeEmailAddressPattern.MatchString(msg.ToEmail) {
		return inboundMessage{}, errMissingField("recipient address")
	}
	return msg, nil
}

type errMissingField string

func (e errMissingField) Error() string { return "missing or invalid " + string(e) }

// secretMatches compares in constant time. Both sides are hashed first so
// the comparison length does not depend on the secret's length.
func secretMatches(provided, expected string) bool {
	a := sha256.Sum256([]byte(provided))
	b := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

func inboundSecretFrom(r *http.Request) string {
	if v := r.Header.Get("X-Webhook-Secret"); v != "" {
		return v
	}
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	return ""
}

// isOwnSenderAddress reports whether an address is one this API sends
// from. Mail from those addresses is archived but never forwarded, so a
// forwarded notification that routes back into the mailbox cannot start a
// loop.
func isOwnSenderAddress(addr string) bool {
	addr = strings.ToLower(addr)
	if addr == "noreply@whiparc.com" {
		return true
	}
	if parsed, err := mail.ParseAddress(os.Getenv("EMAIL_FROM")); err == nil && strings.ToLower(parsed.Address) == addr {
		return true
	}
	return false
}

// POST /api/inbound/email
//
// Authenticated by INBOUND_EMAIL_SECRET, sent as X-Webhook-Secret or as a
// Bearer token. With the variable unset the endpoint is off (503), never
// open. Delivery is idempotent on the provider's message id, because
// providers retry anything that is not a 2xx.
func handleInboundEmail(w http.ResponseWriter, r *http.Request) {
	expected := os.Getenv("INBOUND_EMAIL_SECRET")
	if expected == "" {
		writeJSONError(w, http.StatusServiceUnavailable, "Inbound email is not configured.")
		return
	}
	if !secretMatches(inboundSecretFrom(r), expected) {
		writeJSONError(w, http.StatusUnauthorized, "Invalid webhook secret.")
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxInboundBodyBytes))
	if err != nil {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "Message too large.")
		return
	}
	msg, err := parseInboundEmail(body)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Could not read message: "+err.Error())
		return
	}

	if msg.MessageID != "" {
		var existing string
		err := db.QueryRow("SELECT id FROM inbound_emails WHERE message_id = ?", msg.MessageID).Scan(&existing)
		if err == nil {
			writeJSONStatus(w, http.StatusOK, map[string]string{"status": "duplicate"})
			return
		}
		if err != sql.ErrNoRows {
			log.Printf("[INBOUND] Duplicate check failed: %v\n", err)
			writeJSONError(w, http.StatusInternalServerError, "Could not store message.")
			return
		}
	}

	var messageID interface{}
	if msg.MessageID != "" {
		messageID = msg.MessageID
	}
	_, err = db.Exec(
		`INSERT INTO inbound_emails (id, message_id, from_email, from_name, to_email, subject, text_body, html_body, received_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"in_"+generateRandomHex(12), messageID, msg.FromEmail, msg.FromName, msg.ToEmail, msg.Subject, msg.Text, msg.HTML, time.Now().UTC(),
	)
	if isUniqueViolation(err) {
		// A concurrent delivery of the same message won the race.
		writeJSONStatus(w, http.StatusOK, map[string]string{"status": "duplicate"})
		return
	}
	if err != nil {
		log.Printf("[INBOUND] Failed to store message: %v\n", err)
		writeJSONError(w, http.StatusInternalServerError, "Could not store message.")
		return
	}

	if isOwnSenderAddress(msg.FromEmail) {
		log.Printf("[INBOUND] Stored message from own sender address %s; not forwarding\n", msg.FromEmail)
	} else {
		text := msg.Text
		if text == "" {
			text = "(This message had no plain-text part. It was archived; the HTML part is in the inbound_emails table.)"
		}
		go notifyOwner(InboxNotification{
			Kind:      "inbound",
			FromName:  msg.FromName,
			FromEmail: msg.FromEmail,
			Subject:   msg.Subject,
			Body:      text,
		})
	}

	writeJSONStatus(w, http.StatusOK, map[string]string{"status": "stored"})
}
