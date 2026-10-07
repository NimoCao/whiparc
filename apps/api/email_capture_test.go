package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// recordingMailer captures what the email-capture handlers ask to send. The
// handlers dispatch from goroutines (like every other mailer call site), so
// tests read through waitFor instead of assuming the send already happened.
type recordingMailer struct {
	ConsoleMailer
	mu            sync.Mutex
	confirmations []sentConfirmation
	acks          []sentAck
	notices       []sentNotice
}

type sentConfirmation struct{ to, confirmLink, unsubLink string }
type sentAck struct{ to, name string }
type sentNotice struct {
	to string
	n  InboxNotification
}

func (m *recordingMailer) SendNewsletterConfirmation(to, confirmLink, unsubLink string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.confirmations = append(m.confirmations, sentConfirmation{to, confirmLink, unsubLink})
	return nil
}

func (m *recordingMailer) SendContactAcknowledgement(to, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.acks = append(m.acks, sentAck{to, name})
	return nil
}

func (m *recordingMailer) SendInboxNotification(to string, n InboxNotification) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.notices = append(m.notices, sentNotice{to, n})
	return nil
}

func (m *recordingMailer) counts() (confirmations, acks, notices int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.confirmations), len(m.acks), len(m.notices)
}

func (m *recordingMailer) lastConfirmation() sentConfirmation {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.confirmations[len(m.confirmations)-1]
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// settle gives the handlers' goroutines time to run when a test asserts that
// something was NOT sent.
func settle() { time.Sleep(60 * time.Millisecond) }

func setupCaptureTest(t *testing.T) *recordingMailer {
	t.Helper()
	return installCaptureTestState(t, setupAuthTestDB(t))
}

// installCaptureTestState points the package globals at testDB (SQLite for the
// default tests, Postgres for email_capture_postgres_test.go) plus a
// recordingMailer and permissive limiters, and restores everything on cleanup.
func installCaptureTestState(t *testing.T, testDB *dbHandle) *recordingMailer {
	t.Helper()
	oldDB, oldSender := db, emailSender
	oldSub, oldSubG, oldContact, oldContactG, oldTok := subscribeLimiter, subscribeGlobalLimiter, contactLimiter, contactGlobalLimiter, captureTokenLimiter

	mailer := &recordingMailer{}
	db = testDB
	emailSender = mailer
	subscribeLimiter = NewRateLimiter(1000, time.Hour, 1000)
	subscribeGlobalLimiter = NewRateLimiter(1000, time.Hour, 1000)
	contactLimiter = NewRateLimiter(1000, time.Hour, 1000)
	contactGlobalLimiter = NewRateLimiter(1000, time.Hour, 1000)
	captureTokenLimiter = NewRateLimiter(1000, time.Hour, 1000)

	t.Setenv("FRONTEND_URL", "https://whiparc.test")
	t.Setenv("CONTACT_NOTIFY_EMAIL", "owner@acme-corp.dev")
	t.Setenv("INBOUND_EMAIL_SECRET", "")

	t.Cleanup(func() {
		testDB.Close()
		db, emailSender = oldDB, oldSender
		subscribeLimiter, subscribeGlobalLimiter, contactLimiter, contactGlobalLimiter, captureTokenLimiter = oldSub, oldSubG, oldContact, oldContactG, oldTok
	})
	return mailer
}

func postJSON(h http.HandlerFunc, path string, body interface{}, headers map[string]string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if s, ok := body.(string); ok {
		buf.WriteString(s)
	} else {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.RemoteAddr = "203.0.113.5:4321"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

func tokenFromLink(t *testing.T, link string) string {
	t.Helper()
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("bad link %q: %v", link, err)
	}
	tok := u.Query().Get("token")
	if tok == "" {
		t.Fatalf("no token in link %q", link)
	}
	return tok
}

func subscribe(email string) *httptest.ResponseRecorder {
	return postJSON(handleNewsletterSubscribe, "/api/newsletter/subscribe", map[string]string{"email": email}, nil)
}

func subscriberStatus(t *testing.T, email string) string {
	t.Helper()
	var status string
	if err := db.QueryRow("SELECT status FROM newsletter_subscribers WHERE email = ?", email).Scan(&status); err != nil {
		t.Fatalf("lookup subscriber %s: %v", email, err)
	}
	return status
}

func TestMigration14CreatesCaptureTables(t *testing.T) {
	setupCaptureTest(t)
	for _, table := range []string{"newsletter_subscribers", "contact_messages", "inbound_emails"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatalf("table %s missing: %v", table, err)
		}
	}
	var applied int
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = 14").Scan(&applied); err != nil || applied != 1 {
		t.Fatalf("migration 14 not recorded (count=%d, err=%v)", applied, err)
	}
	// The CHECK constraint is what keeps status values honest across code paths.
	if _, err := db.Exec("INSERT INTO newsletter_subscribers (id, email, status, unsubscribe_token) VALUES ('x', 'a@acme-corp.dev', 'bogus', 'tok')"); err == nil {
		t.Fatal("expected CHECK constraint to reject an unknown status")
	}
}

func TestNewsletterDoubleOptInFlow(t *testing.T) {
	mailer := setupCaptureTest(t)
	const email = "reader@acme-corp.dev"

	first := subscribe("  Reader@Acme-Corp.dev ")
	if first.Code != http.StatusOK {
		t.Fatalf("subscribe: %d %s", first.Code, first.Body.String())
	}
	waitFor(t, "confirmation email", func() bool { c, _, _ := mailer.counts(); return c == 1 })
	if got := mailer.lastConfirmation(); got.to != email {
		t.Fatalf("confirmation went to %q, want normalized %q", got.to, email)
	}
	if status := subscriberStatus(t, email); status != "pending" {
		t.Fatalf("status after signup = %q, want pending (nobody is subscribed before confirming)", status)
	}

	// The confirm token is stored hashed, the unsubscribe token raw.
	conf := mailer.lastConfirmation()
	confirmToken := tokenFromLink(t, conf.confirmLink)
	var storedHash string
	_ = db.QueryRow("SELECT confirm_token_hash FROM newsletter_subscribers WHERE email = ?", email).Scan(&storedHash)
	if storedHash == "" || storedHash == confirmToken || storedHash != hashToken(confirmToken) {
		t.Fatalf("confirm token must be stored as its hash, got %q", storedHash)
	}
	if !strings.HasPrefix(conf.confirmLink, "https://whiparc.test/newsletter/confirm?token=") ||
		!strings.HasPrefix(conf.unsubLink, "https://whiparc.test/newsletter/unsubscribe?token=") {
		t.Fatalf("unexpected links: %q / %q", conf.confirmLink, conf.unsubLink)
	}

	// A second signup inside the cooldown must not send another email.
	if again := subscribe(email); again.Code != http.StatusOK || again.Body.String() != first.Body.String() {
		t.Fatalf("repeat signup response differs: %d %s", again.Code, again.Body.String())
	}
	settle()
	if c, _, _ := mailer.counts(); c != 1 {
		t.Fatalf("cooldown violated: %d confirmation emails", c)
	}

	// Past the cooldown a resend rotates the token and kills the old link.
	if _, err := db.Exec("UPDATE newsletter_subscribers SET confirmation_sent_at = ? WHERE email = ?", time.Now().UTC().Add(-time.Hour), email); err != nil {
		t.Fatal(err)
	}
	subscribe(email)
	waitFor(t, "second confirmation email", func() bool { c, _, _ := mailer.counts(); return c == 2 })
	newToken := tokenFromLink(t, mailer.lastConfirmation().confirmLink)
	if newToken == confirmToken {
		t.Fatal("resend reused the old confirm token")
	}
	if w := postJSON(handleNewsletterConfirm, "/api/newsletter/confirm", map[string]string{"token": confirmToken}, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("old token should be dead, got %d", w.Code)
	}
	if status := subscriberStatus(t, email); status != "pending" {
		t.Fatalf("a rejected confirm changed status to %q", status)
	}

	// Confirm.
	if w := postJSON(handleNewsletterConfirm, "/api/newsletter/confirm", map[string]string{"token": newToken}, nil); w.Code != http.StatusOK {
		t.Fatalf("confirm: %d %s", w.Code, w.Body.String())
	}
	if status := subscriberStatus(t, email); status != "confirmed" {
		t.Fatalf("status after confirm = %q", status)
	}
	var confirmedAt *time.Time
	_ = db.QueryRow("SELECT confirmed_at FROM newsletter_subscribers WHERE email = ?", email).Scan(&confirmedAt)
	if confirmedAt == nil {
		t.Fatal("confirmed_at must record the consent timestamp")
	}

	// Re-opening the link is a success, not an error.
	var repeat struct {
		Status  string `json:"status"`
		Already bool   `json:"already"`
	}
	w := postJSON(handleNewsletterConfirm, "/api/newsletter/confirm", map[string]string{"token": newToken}, nil)
	_ = json.Unmarshal(w.Body.Bytes(), &repeat)
	if w.Code != http.StatusOK || repeat.Status != "confirmed" || !repeat.Already {
		t.Fatalf("repeat confirm: %d %s", w.Code, w.Body.String())
	}

	// A confirmed address never gets another email, and the response does
	// not reveal that it is subscribed.
	if resp := subscribe(email); resp.Body.String() != first.Body.String() {
		t.Fatalf("response for a confirmed address leaks state: %s", resp.Body.String())
	}
	settle()
	if c, _, _ := mailer.counts(); c != 2 {
		t.Fatalf("confirmed address was emailed again (%d)", c)
	}
}

func TestNewsletterConfirmRejectsExpiredAndBogusTokens(t *testing.T) {
	mailer := setupCaptureTest(t)
	subscribe("late@acme-corp.dev")
	waitFor(t, "confirmation", func() bool { c, _, _ := mailer.counts(); return c == 1 })
	token := tokenFromLink(t, mailer.lastConfirmation().confirmLink)

	if _, err := db.Exec("UPDATE newsletter_subscribers SET confirm_expires_at = ? WHERE email = 'late@acme-corp.dev'", time.Now().UTC().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if w := postJSON(handleNewsletterConfirm, "/api/newsletter/confirm", map[string]string{"token": token}, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("expired token: got %d", w.Code)
	}
	if status := subscriberStatus(t, "late@acme-corp.dev"); status != "pending" {
		t.Fatalf("expired confirm changed status to %q", status)
	}

	for _, bad := range []string{"", "short", strings.Repeat("a", 200), strings.Repeat("f", 64)} {
		if w := postJSON(handleNewsletterConfirm, "/api/newsletter/confirm", map[string]string{"token": bad}, nil); w.Code != http.StatusBadRequest {
			t.Fatalf("token %q: got %d, want 400", bad, w.Code)
		}
	}
	if w := postJSON(handleNewsletterConfirm, "/api/newsletter/confirm", "{not json", nil); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed JSON: got %d", w.Code)
	}
}

func TestNewsletterUnsubscribe(t *testing.T) {
	mailer := setupCaptureTest(t)
	const email = "leaver@acme-corp.dev"
	subscribe(email)
	waitFor(t, "confirmation", func() bool { c, _, _ := mailer.counts(); return c == 1 })
	conf := mailer.lastConfirmation()
	confirmToken, unsubToken := tokenFromLink(t, conf.confirmLink), tokenFromLink(t, conf.unsubLink)
	postJSON(handleNewsletterConfirm, "/api/newsletter/confirm", map[string]string{"token": confirmToken}, nil)

	// Query-string token with a form body is the RFC 8058 one-click shape.
	req := httptest.NewRequest(http.MethodPost, "/api/newsletter/unsubscribe?token="+unsubToken, strings.NewReader("List-Unsubscribe=One-Click"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "203.0.113.5:1"
	w := httptest.NewRecorder()
	handleNewsletterUnsubscribe(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("one-click unsubscribe: %d %s", w.Code, w.Body.String())
	}
	if status := subscriberStatus(t, email); status != "unsubscribed" {
		t.Fatalf("status = %q", status)
	}

	// Idempotent, via the JSON-body form the page uses.
	if w := postJSON(handleNewsletterUnsubscribe, "/api/newsletter/unsubscribe", map[string]string{"token": unsubToken}, nil); w.Code != http.StatusOK {
		t.Fatalf("second unsubscribe: %d", w.Code)
	}

	// The confirmation email that is still in their inbox must not undo it.
	if w := postJSON(handleNewsletterConfirm, "/api/newsletter/confirm", map[string]string{"token": confirmToken}, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("stale confirm link after unsubscribe: got %d, want 400", w.Code)
	}
	if status := subscriberStatus(t, email); status != "unsubscribed" {
		t.Fatalf("stale confirm resubscribed the address (status %q)", status)
	}

	// Unknown tokens are a 404 and change nothing.
	if w := postJSON(handleNewsletterUnsubscribe, "/api/newsletter/unsubscribe", map[string]string{"token": strings.Repeat("0", 32)}, nil); w.Code != http.StatusNotFound {
		t.Fatalf("unknown token: got %d", w.Code)
	}

	// Coming back requires a fresh confirmation, subject to the cooldown.
	if _, err := db.Exec("UPDATE newsletter_subscribers SET confirmation_sent_at = ? WHERE email = ?", time.Now().UTC().Add(-time.Hour), email); err != nil {
		t.Fatal(err)
	}
	subscribe(email)
	waitFor(t, "re-subscribe confirmation", func() bool { c, _, _ := mailer.counts(); return c == 2 })
	if status := subscriberStatus(t, email); status != "pending" {
		t.Fatalf("re-subscribe status = %q, want pending until confirmed", status)
	}
	if newUnsub := tokenFromLink(t, mailer.lastConfirmation().unsubLink); newUnsub != unsubToken {
		t.Fatal("the unsubscribe token must stay stable across re-subscribes so old emails keep working")
	}
}

func TestNewsletterSubscribeValidation(t *testing.T) {
	mailer := setupCaptureTest(t)

	for _, bad := range []string{"", "not-an-email", "a@b", "x@mailinator.com", strings.Repeat("a", 250) + "@acme-corp.dev"} {
		if w := subscribe(bad); w.Code != http.StatusBadRequest {
			t.Fatalf("email %q: got %d, want 400", bad, w.Code)
		}
	}
	if w := postJSON(handleNewsletterSubscribe, "/api/newsletter/subscribe", "{broken", nil); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed JSON: got %d", w.Code)
	}
	oversized := `{"email":"big@acme-corp.dev","source":"` + strings.Repeat("x", maxCaptureBodyBytes) + `"}`
	if w := postJSON(handleNewsletterSubscribe, "/api/newsletter/subscribe", oversized, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("oversized body: got %d", w.Code)
	}

	// Honeypot: looks like success, stores and sends nothing.
	w := postJSON(handleNewsletterSubscribe, "/api/newsletter/subscribe", map[string]string{"email": "bot@acme-corp.dev", "website": "http://spam.test"}, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("honeypot response: %d", w.Code)
	}
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM newsletter_subscribers").Scan(&n)
	settle()
	if c, _, _ := mailer.counts(); n != 0 || c != 0 {
		t.Fatalf("honeypot hit stored %d rows and sent %d emails", n, c)
	}

	// An unusable "source" falls back instead of being stored verbatim.
	postJSON(handleNewsletterSubscribe, "/api/newsletter/subscribe", map[string]string{"email": "src@acme-corp.dev", "source": "<script>"}, nil)
	var source string
	_ = db.QueryRow("SELECT source FROM newsletter_subscribers WHERE email = 'src@acme-corp.dev'").Scan(&source)
	if source != "footer" {
		t.Fatalf("source = %q, want fallback 'footer'", source)
	}
}

func TestNewsletterRateLimits(t *testing.T) {
	mailer := setupCaptureTest(t)

	subscribeLimiter = NewRateLimiter(2, time.Hour, 2)
	for i, want := range []int{200, 200, 429} {
		if w := subscribe("limit" + string(rune('a'+i)) + "@acme-corp.dev"); w.Code != want {
			t.Fatalf("request %d: got %d, want %d", i, w.Code, want)
		}
	}

	// The global ceiling holds even when every request claims a new IP.
	subscribeLimiter = NewRateLimiter(1000, time.Hour, 1000)
	subscribeGlobalLimiter = NewRateLimiter(1, time.Hour, 1)
	hdr := func(ip string) map[string]string { return map[string]string{"X-Forwarded-For": ip} }
	if w := postJSON(handleNewsletterSubscribe, "/x", map[string]string{"email": "g1@acme-corp.dev"}, hdr("198.51.100.1")); w.Code != http.StatusOK {
		t.Fatalf("first global request: %d", w.Code)
	}
	if w := postJSON(handleNewsletterSubscribe, "/x", map[string]string{"email": "g2@acme-corp.dev"}, hdr("198.51.100.2")); w.Code != http.StatusTooManyRequests {
		t.Fatalf("spoofed-IP request past global ceiling: got %d, want 429", w.Code)
	}
	settle()
	_ = mailer
}

func TestContactStoresNotifiesAndAcknowledges(t *testing.T) {
	mailer := setupCaptureTest(t)

	w := postJSON(handleContact, "/api/contact", map[string]string{
		"name": "Ada\r\nBcc: victim@acme-corp.dev", "email": "Ada@Acme-Corp.dev", "message": "Hello,\r\nCan you add a Hetzner node?\x00",
	}, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("contact: %d %s", w.Code, w.Body.String())
	}
	waitFor(t, "owner notification and ack", func() bool { _, a, n := mailer.counts(); return a == 1 && n == 1 })

	mailer.mu.Lock()
	notice, ack := mailer.notices[0], mailer.acks[0]
	mailer.mu.Unlock()
	if notice.to != "owner@acme-corp.dev" || notice.n.Kind != "contact" || notice.n.FromEmail != "ada@acme-corp.dev" {
		t.Fatalf("unexpected notice: %+v", notice)
	}
	if strings.ContainsAny(notice.n.FromName, "\r\n") {
		t.Fatalf("CRLF survived in name: %q", notice.n.FromName)
	}
	if strings.ContainsAny(notice.n.Body, "\x00\r") || !strings.Contains(notice.n.Body, "Hetzner") {
		t.Fatalf("body not cleaned: %q", notice.n.Body)
	}
	if ack.to != "ada@acme-corp.dev" {
		t.Fatalf("ack went to %q", ack.to)
	}

	var name, message, status string
	if err := db.QueryRow("SELECT name, message, status FROM contact_messages WHERE email = 'ada@acme-corp.dev'").Scan(&name, &message, &status); err != nil {
		t.Fatalf("message not stored: %v", err)
	}
	if strings.ContainsAny(name, "\r\n") || status != "new" {
		t.Fatalf("stored name=%q status=%q", name, status)
	}
}

func TestContactValidationHoneypotAndLimits(t *testing.T) {
	mailer := setupCaptureTest(t)
	good := map[string]string{"name": "Ada", "email": "ada@acme-corp.dev", "message": "A perfectly reasonable message."}
	with := func(k, v string) map[string]string {
		m := map[string]string{}
		for kk, vv := range good {
			m[kk] = vv
		}
		m[k] = v
		return m
	}

	cases := map[string]map[string]string{
		"missing name":      with("name", "   "),
		"bad email":         with("email", "nope"),
		"disposable":        with("email", "x@mailinator.com"),
		"message too short": with("message", "hi"),
	}
	for label, body := range cases {
		if w := postJSON(handleContact, "/api/contact", body, nil); w.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d, want 400", label, w.Code)
		}
	}
	// The message length cap is enforced by truncation, not rejection.
	long := with("message", strings.Repeat("word ", 2000))
	if w := postJSON(handleContact, "/api/contact", long, nil); w.Code != http.StatusOK {
		t.Fatalf("long message: %d", w.Code)
	}
	var stored string
	_ = db.QueryRow("SELECT message FROM contact_messages").Scan(&stored)
	if len([]rune(stored)) > maxContactMsgRunes {
		t.Fatalf("stored %d runes, cap is %d", len([]rune(stored)), maxContactMsgRunes)
	}

	// Honeypot.
	before := 0
	_ = db.QueryRow("SELECT COUNT(*) FROM contact_messages").Scan(&before)
	if w := postJSON(handleContact, "/api/contact", with("website", "http://spam.test"), nil); w.Code != http.StatusOK {
		t.Fatalf("honeypot: %d", w.Code)
	}
	after := 0
	_ = db.QueryRow("SELECT COUNT(*) FROM contact_messages").Scan(&after)
	if after != before {
		t.Fatal("honeypot submission was stored")
	}
	_ = mailer
}

func TestContactPerAddressHourlyCap(t *testing.T) {
	setupCaptureTest(t)
	body := map[string]string{"name": "Ada", "email": "cap@acme-corp.dev", "message": "A perfectly reasonable message."}

	// Old messages fall outside the window and do not count.
	for i := 0; i < 5; i++ {
		if _, err := db.Exec("INSERT INTO contact_messages (id, name, email, message, created_at) VALUES (?, 'Ada', 'cap@acme-corp.dev', 'old message body', ?)",
			"old_"+string(rune('a'+i)), time.Now().UTC().Add(-3*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < maxContactPerEmailPerHour; i++ {
		if w := postJSON(handleContact, "/api/contact", body, nil); w.Code != http.StatusOK {
			t.Fatalf("message %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	if w := postJSON(handleContact, "/api/contact", body, nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("message past cap: got %d, want 429", w.Code)
	}
}

func TestContactRateLimiters(t *testing.T) {
	setupCaptureTest(t)
	body := func(i int) map[string]string {
		return map[string]string{"name": "Ada", "email": "rl" + string(rune('a'+i)) + "@acme-corp.dev", "message": "A perfectly reasonable message."}
	}
	contactLimiter = NewRateLimiter(1, time.Hour, 1)
	if w := postJSON(handleContact, "/c", body(0), nil); w.Code != http.StatusOK {
		t.Fatalf("first: %d", w.Code)
	}
	if w := postJSON(handleContact, "/c", body(1), nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("second from same IP: got %d", w.Code)
	}
	contactLimiter = NewRateLimiter(1000, time.Hour, 1000)
	contactGlobalLimiter = NewRateLimiter(1, time.Hour, 1)
	if w := postJSON(handleContact, "/c", body(2), map[string]string{"X-Forwarded-For": "198.51.100.9"}); w.Code != http.StatusOK {
		t.Fatalf("global first: %d", w.Code)
	}
	if w := postJSON(handleContact, "/c", body(3), map[string]string{"X-Forwarded-For": "198.51.100.10"}); w.Code != http.StatusTooManyRequests {
		t.Fatalf("global ceiling: got %d", w.Code)
	}
}

func TestContactWithoutNotifyEmailStillStores(t *testing.T) {
	mailer := setupCaptureTest(t)
	t.Setenv("CONTACT_NOTIFY_EMAIL", "")
	w := postJSON(handleContact, "/api/contact", map[string]string{"name": "Ada", "email": "ada@acme-corp.dev", "message": "A perfectly reasonable message."}, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("contact: %d", w.Code)
	}
	waitFor(t, "ack", func() bool { _, a, _ := mailer.counts(); return a == 1 })
	settle()
	// recordingMailer is not a *ConsoleMailer, so with no owner address the
	// notification is skipped (logged), but the message is kept.
	if _, _, n := mailer.counts(); n != 0 {
		t.Fatalf("notification sent without CONTACT_NOTIFY_EMAIL: %d", n)
	}
	var c int
	_ = db.QueryRow("SELECT COUNT(*) FROM contact_messages").Scan(&c)
	if c != 1 {
		t.Fatalf("stored %d messages", c)
	}
}
