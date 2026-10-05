package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Marketing-site email capture: the footer's newsletter signup (double
// opt-in) and the /contact form. Both are unauthenticated, public POST
// endpoints that make this server send mail to an address the caller
// typed, so they are written defensively:
//
//   - A caller can make us email a third party. Subscribing sends exactly
//     one confirmation, never a second inside newsletterResendCooldown, and
//     nobody is subscribed until the link in that email is opened.
//   - Responses never reveal whether an address is already subscribed.
//   - A hidden "website" form field is a honeypot: bots that fill it get a
//     normal-looking success and nothing is stored or sent.
//   - Per-IP limits sit on top of a global ceiling. The per-IP limiter
//     shares ClientIP's trust-the-header weakness (product-memory 04.4
//     finding 2), so the global ceiling is the control that still holds
//     when that header is spoofed.
const (
	newsletterConfirmTTL     = 48 * time.Hour
	newsletterResendCooldown = 10 * time.Minute

	maxCaptureBodyBytes = 32 << 10
	maxContactNameRunes = 100
	minContactMsgRunes  = 10
	maxContactMsgRunes  = 4000
	// Messages from one address per hour, so a victim's address cannot be
	// used to trigger an unbounded stream of acknowledgements.
	maxContactPerEmailPerHour = 3
)

var (
	subscribeLimiter       *RateLimiter
	subscribeGlobalLimiter *RateLimiter
	contactLimiter         *RateLimiter
	contactGlobalLimiter   *RateLimiter
	captureTokenLimiter    *RateLimiter
)

var sourcePattern = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)

func writeJSONStatus(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSONStatus(w, status, map[string]string{"error": msg})
}

func decodeCaptureBody(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxCaptureBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid request.")
		return false
	}
	return true
}

func isUniqueViolation(err error) bool {
	// SQLite says "UNIQUE constraint failed", Postgres says "duplicate key
	// value violates unique constraint"; same case-insensitive match
	// handleSignup uses.
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}

func frontendLink(path, token string) string {
	return fmt.Sprintf("%s%s?token=%s", strings.TrimRight(oauthFrontendBase(), "/"), path, token)
}

// ---------------------------------------------------------------------
// Newsletter
// ---------------------------------------------------------------------

type subscribeOutcome struct {
	send         bool
	confirmToken string
	unsubToken   string
}

// registerSubscriber records a signup attempt and says whether a
// confirmation email should go out. It is the only place the
// cooldown/state rules live, so the handler stays a thin wrapper.
func registerSubscriber(email, source string, now time.Time) (subscribeOutcome, error) {
	var id, status, unsubToken string
	var sentAt sql.NullTime
	err := db.QueryRow(
		"SELECT id, status, confirmation_sent_at, unsubscribe_token FROM newsletter_subscribers WHERE email = ?",
		email,
	).Scan(&id, &status, &sentAt, &unsubToken)

	rawToken := generateRandomHex(32)
	expires := now.Add(newsletterConfirmTTL)

	switch {
	case err == sql.ErrNoRows:
		unsubToken = generateRandomHex(16)
		_, insErr := db.Exec(
			`INSERT INTO newsletter_subscribers
			 (id, email, status, confirm_token_hash, confirm_expires_at, unsubscribe_token, source, confirmation_sent_at, created_at, updated_at)
			 VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
			"sub_"+generateRandomHex(12), email, hashToken(rawToken), expires, unsubToken, source, now, now, now,
		)
		if isUniqueViolation(insErr) {
			// Lost a race with a concurrent signup for the same address;
			// that request already sent the confirmation.
			return subscribeOutcome{}, nil
		}
		if insErr != nil {
			return subscribeOutcome{}, insErr
		}
		return subscribeOutcome{send: true, confirmToken: rawToken, unsubToken: unsubToken}, nil

	case err != nil:
		return subscribeOutcome{}, err

	case status == "confirmed":
		return subscribeOutcome{}, nil

	default: // pending, or unsubscribed and now asking to come back
		if sentAt.Valid && now.Sub(sentAt.Time) < newsletterResendCooldown {
			return subscribeOutcome{}, nil
		}
		if _, err := db.Exec(
			`UPDATE newsletter_subscribers
			 SET status = 'pending', confirm_token_hash = ?, confirm_expires_at = ?, confirmation_sent_at = ?,
			     unsubscribed_at = NULL, updated_at = ?
			 WHERE id = ?`,
			hashToken(rawToken), expires, now, now, id,
		); err != nil {
			return subscribeOutcome{}, err
		}
		return subscribeOutcome{send: true, confirmToken: rawToken, unsubToken: unsubToken}, nil
	}
}

// POST /api/newsletter/subscribe
func handleNewsletterSubscribe(w http.ResponseWriter, r *http.Request) {
	if !subscribeLimiter.Allow(ClientIP(r)) || !subscribeGlobalLimiter.Allow("global") {
		writeJSONError(w, http.StatusTooManyRequests, "Too many requests. Please try again in a little while.")
		return
	}

	var payload struct {
		Email   string `json:"email"`
		Website string `json:"website"`
		Source  string `json:"source"`
	}
	if !decodeCaptureBody(w, r, &payload) {
		return
	}

	const accepted = "Almost done. Check your inbox and confirm your email to finish subscribing."

	if payload.Website != "" {
		writeJSONStatus(w, http.StatusOK, map[string]string{"message": accepted})
		return
	}

	email := strings.TrimSpace(strings.ToLower(payload.Email))
	if err := ValidateEmail(email); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	source := "footer"
	if sourcePattern.MatchString(payload.Source) {
		source = payload.Source
	}

	outcome, err := registerSubscriber(email, source, time.Now().UTC())
	if err != nil {
		log.Printf("[NEWSLETTER] Failed to record signup: %v\n", err)
		writeJSONError(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
		return
	}

	if outcome.send {
		confirmLink := frontendLink("/newsletter/confirm", outcome.confirmToken)
		unsubLink := frontendLink("/newsletter/unsubscribe", outcome.unsubToken)
		go func() {
			if err := emailSender.SendNewsletterConfirmation(email, confirmLink, unsubLink); err != nil {
				log.Printf("[EMAIL] Failed to send newsletter confirmation to %s: %v\n", email, err)
			}
		}()
	}

	writeJSONStatus(w, http.StatusOK, map[string]string{"message": accepted})
}

// POST /api/newsletter/confirm
//
// POST rather than GET so a mail client or security scanner prefetching the
// link cannot confirm on the recipient's behalf; the frontend page makes
// this call. Opening an already-used link reports success instead of an
// error, since the person's goal state (subscribed) is already true.
func handleNewsletterConfirm(w http.ResponseWriter, r *http.Request) {
	if !captureTokenLimiter.Allow(ClientIP(r)) {
		writeJSONError(w, http.StatusTooManyRequests, "Too many requests. Please try again in a little while.")
		return
	}
	var payload struct {
		Token string `json:"token"`
	}
	if !decodeCaptureBody(w, r, &payload) {
		return
	}
	if len(payload.Token) < 16 || len(payload.Token) > 128 {
		writeJSONError(w, http.StatusBadRequest, "This confirmation link is invalid or has expired.")
		return
	}

	var id, status string
	var expires sql.NullTime
	err := db.QueryRow(
		"SELECT id, status, confirm_expires_at FROM newsletter_subscribers WHERE confirm_token_hash = ?",
		hashToken(payload.Token),
	).Scan(&id, &status, &expires)
	if err == sql.ErrNoRows {
		writeJSONError(w, http.StatusBadRequest, "This confirmation link is invalid or has expired.")
		return
	}
	if err != nil {
		log.Printf("[NEWSLETTER] Confirm lookup failed: %v\n", err)
		writeJSONError(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
		return
	}

	if status == "confirmed" {
		writeJSONStatus(w, http.StatusOK, map[string]interface{}{"status": "confirmed", "already": true})
		return
	}
	now := time.Now().UTC()
	if status != "pending" || !expires.Valid || now.After(expires.Time) {
		writeJSONError(w, http.StatusBadRequest, "This confirmation link is invalid or has expired.")
		return
	}

	// status = 'pending' in the WHERE makes this a no-op if an unsubscribe
	// landed between the SELECT above and here.
	if _, err := db.Exec(
		"UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
		now, now, id,
	); err != nil {
		log.Printf("[NEWSLETTER] Confirm update failed: %v\n", err)
		writeJSONError(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]interface{}{"status": "confirmed"})
}

// POST /api/newsletter/unsubscribe
//
// The token may arrive in the JSON body (the /newsletter/unsubscribe page)
// or in the query string, which is how RFC 8058 one-click unsubscribe
// (List-Unsubscribe-Post) delivers it: a bare POST with a form body.
func handleNewsletterUnsubscribe(w http.ResponseWriter, r *http.Request) {
	if !captureTokenLimiter.Allow(ClientIP(r)) {
		writeJSONError(w, http.StatusTooManyRequests, "Too many requests. Please try again in a little while.")
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		var payload struct {
			Token string `json:"token"`
		}
		if !decodeCaptureBody(w, r, &payload) {
			return
		}
		token = payload.Token
	}
	if len(token) < 16 || len(token) > 128 {
		writeJSONError(w, http.StatusNotFound, "This unsubscribe link is not valid.")
		return
	}

	var id string
	err := db.QueryRow("SELECT id FROM newsletter_subscribers WHERE unsubscribe_token = ?", token).Scan(&id)
	if err == sql.ErrNoRows {
		writeJSONError(w, http.StatusNotFound, "This unsubscribe link is not valid.")
		return
	}
	if err != nil {
		log.Printf("[NEWSLETTER] Unsubscribe lookup failed: %v\n", err)
		writeJSONError(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
		return
	}

	now := time.Now().UTC()
	// Clearing the confirm token means a stale confirmation email cannot
	// quietly resubscribe someone who has since opted out.
	if _, err := db.Exec(
		`UPDATE newsletter_subscribers
		 SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token_hash = NULL, confirm_expires_at = NULL, updated_at = ?
		 WHERE id = ? AND status != 'unsubscribed'`,
		now, now, id,
	); err != nil {
		log.Printf("[NEWSLETTER] Unsubscribe update failed: %v\n", err)
		writeJSONError(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
		return
	}
	writeJSONStatus(w, http.StatusOK, map[string]string{"status": "unsubscribed"})
}

// ---------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------

// contactNotifyEmail is where contact-form messages and forwarded inbound
// mail are delivered. Unset means "store only".
func contactNotifyEmail() string {
	return strings.TrimSpace(os.Getenv("CONTACT_NOTIFY_EMAIL"))
}

// notifyOwner emails the site owner, or logs why it could not. Callers run
// it in a goroutine so a slow mail provider never blocks a request.
func notifyOwner(n InboxNotification) {
	to := contactNotifyEmail()
	if to == "" {
		if _, isConsole := emailSender.(*ConsoleMailer); !isConsole {
			log.Printf("[EMAIL] CONTACT_NOTIFY_EMAIL is not set; %s message from %s was stored but not forwarded\n", n.Kind, sanitizeHeaderField(n.FromEmail))
			return
		}
		to = "owner@console.invalid"
	}
	if err := emailSender.SendInboxNotification(to, n); err != nil {
		log.Printf("[EMAIL] Failed to send %s notification: %v\n", n.Kind, err)
	}
}

// POST /api/contact
func handleContact(w http.ResponseWriter, r *http.Request) {
	if !contactLimiter.Allow(ClientIP(r)) || !contactGlobalLimiter.Allow("global") {
		writeJSONError(w, http.StatusTooManyRequests, "Too many messages. Please try again in a little while.")
		return
	}

	var payload struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Message string `json:"message"`
		Website string `json:"website"`
	}
	if !decodeCaptureBody(w, r, &payload) {
		return
	}

	const accepted = "Thanks. Your message was sent and we will reply by email."

	if payload.Website != "" {
		writeJSONStatus(w, http.StatusOK, map[string]string{"message": accepted})
		return
	}

	name := cleanSingleLine(payload.Name, maxContactNameRunes)
	message := cleanFreeText(payload.Message, maxContactMsgRunes)
	email := strings.TrimSpace(strings.ToLower(payload.Email))

	if name == "" {
		writeJSONError(w, http.StatusBadRequest, "Please enter your name.")
		return
	}
	if err := ValidateEmail(email); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if utf8.RuneCountInString(message) < minContactMsgRunes {
		writeJSONError(w, http.StatusBadRequest, "Please write a little more so we can help.")
		return
	}

	now := time.Now().UTC()
	var recent int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM contact_messages WHERE email = ? AND created_at > ?",
		email, now.Add(-time.Hour),
	).Scan(&recent); err != nil {
		log.Printf("[CONTACT] Rate lookup failed: %v\n", err)
		writeJSONError(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
		return
	}
	if recent >= maxContactPerEmailPerHour {
		writeJSONError(w, http.StatusTooManyRequests, "Too many messages from this address. Please try again later.")
		return
	}

	if _, err := db.Exec(
		"INSERT INTO contact_messages (id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)",
		"msg_"+generateRandomHex(12), name, email, message, now,
	); err != nil {
		log.Printf("[CONTACT] Failed to store message: %v\n", err)
		writeJSONError(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
		return
	}

	go notifyOwner(InboxNotification{Kind: "contact", FromName: name, FromEmail: email, Body: message})
	go func() {
		if err := emailSender.SendContactAcknowledgement(email, name); err != nil {
			log.Printf("[EMAIL] Failed to send contact acknowledgement to %s: %v\n", email, err)
		}
	}()

	writeJSONStatus(w, http.StatusOK, map[string]string{"message": accepted})
}
