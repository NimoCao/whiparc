package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// TestEmailCaptureOnPostgres runs the email-capture flows against a real
// Postgres, the same way TestPostgresSchemaAndRebind does for the core
// schema: skipped unless TEST_DATABASE_URL is set (CI provides it).
//
// The SQLite-backed tests cannot catch the differences that matter here:
// migration 14's DDL through pgSchema, time comparisons on TIMESTAMPTZ
// columns, Postgres rejecting NUL bytes in TEXT, and its wording of a
// unique-constraint violation (which isUniqueViolation matches on). Each run
// works in its own throwaway schema so it never collides with other tests
// or earlier runs.
func TestEmailCaptureOnPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping Postgres integration test")
	}

	schema := fmt.Sprintf("capture_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer admin.Close()
	if _, err := admin.Exec("CREATE SCHEMA " + schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	defer admin.Exec("DROP SCHEMA " + schema + " CASCADE")

	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	rawDB, err := sql.Open("pgx", dsn+sep+"search_path="+schema)
	if err != nil {
		t.Fatalf("sql.Open scoped: %v", err)
	}
	pg := &dbHandle{DB: rawDB, backend: "postgres"}
	if _, err := pg.Exec(pgSchema(sqliteSchemaSQL)); err != nil {
		t.Fatalf("base schema: %v", err)
	}
	if err := runMigrations(pg); err != nil {
		t.Fatalf("migrations on Postgres: %v", err)
	}
	mailer := installCaptureTestState(t, pg)

	// --- Newsletter: signup, cooldown, confirm, unsubscribe, return ---
	const email = "pg-reader@acme-corp.dev"
	if w := subscribe(email); w.Code != http.StatusOK {
		t.Fatalf("subscribe: %d %s", w.Code, w.Body.String())
	}
	waitFor(t, "confirmation", func() bool { c, _, _ := mailer.counts(); return c == 1 })
	subscribe(email)
	settle()
	if c, _, _ := mailer.counts(); c != 1 {
		t.Fatalf("cooldown not applied on Postgres: %d emails", c)
	}
	token := tokenFromLink(t, mailer.lastConfirmation().confirmLink)
	unsubToken := tokenFromLink(t, mailer.lastConfirmation().unsubLink)
	if w := postJSON(handleNewsletterConfirm, "/c", map[string]string{"token": token}, nil); w.Code != http.StatusOK {
		t.Fatalf("confirm: %d %s", w.Code, w.Body.String())
	}
	if status := subscriberStatus(t, email); status != "confirmed" {
		t.Fatalf("status = %q", status)
	}
	if w := postJSON(handleNewsletterUnsubscribe, "/u", map[string]string{"token": unsubToken}, nil); w.Code != http.StatusOK {
		t.Fatalf("unsubscribe: %d", w.Code)
	}
	if status := subscriberStatus(t, email); status != "unsubscribed" {
		t.Fatalf("status = %q", status)
	}
	if _, err := db.Exec("UPDATE newsletter_subscribers SET confirmation_sent_at = ? WHERE email = ?", time.Now().UTC().Add(-time.Hour), email); err != nil {
		t.Fatal(err)
	}
	subscribe(email)
	waitFor(t, "re-subscribe confirmation", func() bool { c, _, _ := mailer.counts(); return c == 2 })
	if status := subscriberStatus(t, email); status != "pending" {
		t.Fatalf("status after returning = %q", status)
	}
	if _, err := db.Exec("UPDATE newsletter_subscribers SET confirm_expires_at = ? WHERE email = ?", time.Now().UTC().Add(-time.Minute), email); err != nil {
		t.Fatal(err)
	}
	if w := postJSON(handleNewsletterConfirm, "/c", map[string]string{"token": tokenFromLink(t, mailer.lastConfirmation().confirmLink)}, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("expired token on Postgres: got %d", w.Code)
	}

	// The CHECK constraint survived the pgSchema translation.
	if _, err := db.Exec("INSERT INTO newsletter_subscribers (id, email, status, unsubscribe_token) VALUES ('x', 'bad@acme-corp.dev', 'bogus', 'tok')"); err == nil {
		t.Fatal("status CHECK constraint missing on Postgres")
	}

	// --- Contact: hourly cap compares TIMESTAMPTZ values ---
	body := map[string]string{"name": "Ada", "email": "pg-cap@acme-corp.dev", "message": "A perfectly reasonable message."}
	if _, err := db.Exec("INSERT INTO contact_messages (id, name, email, message, created_at) VALUES ('old1', 'Ada', 'pg-cap@acme-corp.dev', 'an old message', ?)", time.Now().UTC().Add(-3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < maxContactPerEmailPerHour; i++ {
		if w := postJSON(handleContact, "/contact", body, nil); w.Code != http.StatusOK {
			t.Fatalf("contact %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	if w := postJSON(handleContact, "/contact", body, nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("contact past cap on Postgres: got %d", w.Code)
	}

	// --- Inbound: NUL bytes, idempotency, unique-violation wording ---
	t.Setenv("INBOUND_EMAIL_SECRET", testInboundSecret)
	payload := `{"from":"ada@acme-corp.dev","to":"hello@whiparc.com","subject":"Hi","text":"a\u0000b","html":"<p>x\u0000y</p>","messageId":"pg-1"}`
	if w := postJSON(handleInboundEmail, "/i", payload, inboundHeaders()); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "stored") {
		t.Fatalf("inbound: %d %s", w.Code, w.Body.String())
	}
	if w := postJSON(handleInboundEmail, "/i", payload, inboundHeaders()); !strings.Contains(w.Body.String(), "duplicate") {
		t.Fatalf("inbound retry: %d %s", w.Code, w.Body.String())
	}
	var stored string
	if err := db.QueryRow("SELECT text_body FROM inbound_emails WHERE message_id = 'pg-1'").Scan(&stored); err != nil || stored != "ab" {
		t.Fatalf("text_body = %q, %v", stored, err)
	}
	_, dupErr := db.Exec("INSERT INTO inbound_emails (id, message_id, from_email, to_email) VALUES ('d2', 'pg-1', 'a@acme-corp.dev', 'b@acme-corp.dev')")
	if !isUniqueViolation(dupErr) {
		t.Fatalf("isUniqueViolation did not recognize Postgres's error: %v", dupErr)
	}
}
