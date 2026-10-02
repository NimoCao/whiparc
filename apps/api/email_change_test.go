package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func setupEmailChangeTest(t *testing.T) *dbHandle {
	t.Helper()
	testDB := setupAuthTestDB(t)
	emailSender = &ConsoleMailer{}
	emailChangeLimiter = NewRateLimiter(100, time.Hour, 100)
	return testDB
}

func TestRequestEmailChangeFullFlow(t *testing.T) {
	oldDB := db
	testDB := setupEmailChangeTest(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	hash, _ := hashPassword("correct-password")
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'old@test.com', ?, 'Test User', TRUE)", hash); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"newEmail": "new@test.com", "currentPassword": "correct-password"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/change", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_1"}))
	w := httptest.NewRecorder()
	handleRequestEmailChange(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// The live email column must stay untouched until confirmation.
	var liveEmail string
	var pendingEmail, pendingHash sql.NullString
	if err := testDB.QueryRow("SELECT email, pending_email, pending_email_token_hash FROM users WHERE id = 'u_1'").Scan(&liveEmail, &pendingEmail, &pendingHash); err != nil {
		t.Fatalf("query user: %v", err)
	}
	if liveEmail != "old@test.com" {
		t.Fatalf("expected live email unchanged before confirmation, got %q", liveEmail)
	}
	if pendingEmail.String != "new@test.com" || !pendingHash.Valid {
		t.Fatalf("expected pending_email/token_hash to be set, got pending=%q hashValid=%v", pendingEmail.String, pendingHash.Valid)
	}

	// Reconstruct the raw token the same way the real email link would carry
	// it, by pinning a known value (mirrors password_reset_test.go's
	// approach — the raw token itself isn't recoverable from the hash).
	rawToken := "test-email-change-token"
	if _, err := testDB.Exec("UPDATE users SET pending_email_token_hash = ? WHERE id = 'u_1'", hashToken(rawToken)); err != nil {
		t.Fatalf("pin token: %v", err)
	}

	confirmBody, _ := json.Marshal(map[string]string{"token": rawToken})
	confirmReq := httptest.NewRequest(http.MethodPost, "/api/auth/email/confirm", bytes.NewReader(confirmBody))
	confirmW := httptest.NewRecorder()
	handleConfirmEmailChange(confirmW, confirmReq)
	if confirmW.Code != http.StatusOK {
		t.Fatalf("expected 200 from confirm, got %d: %s", confirmW.Code, confirmW.Body.String())
	}
	var confirmResp struct {
		Token string `json:"token"`
		User  struct {
			Email string `json:"email"`
		} `json:"user"`
	}
	if err := json.Unmarshal(confirmW.Body.Bytes(), &confirmResp); err != nil {
		t.Fatalf("decode confirm response: %v", err)
	}
	if confirmResp.Token == "" {
		t.Fatalf("expected a re-issued session token reflecting the new email")
	}
	if confirmResp.User.Email != "new@test.com" {
		t.Fatalf("expected confirmed email new@test.com, got %q", confirmResp.User.Email)
	}

	var finalEmail string
	var finalPending sql.NullString
	var verified bool
	if err := testDB.QueryRow("SELECT email, pending_email, email_verified FROM users WHERE id = 'u_1'").Scan(&finalEmail, &finalPending, &verified); err != nil {
		t.Fatalf("query final user: %v", err)
	}
	if finalEmail != "new@test.com" {
		t.Fatalf("expected live email updated to new@test.com, got %q", finalEmail)
	}
	if finalPending.Valid {
		t.Fatalf("expected pending_email cleared after confirmation, got %q", finalPending.String)
	}
	if !verified {
		t.Fatalf("expected email_verified = true after confirming a new address")
	}
}

func TestRequestEmailChangeBlockedForOAuthOnlyAccount(t *testing.T) {
	oldDB := db
	testDB := setupEmailChangeTest(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'oauth@test.com', NULL, 'OAuth User', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"newEmail": "new@test.com", "currentPassword": "anything"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/change", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_1"}))
	w := httptest.NewRecorder()
	handleRequestEmailChange(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an OAuth-only account with no password, got %d: %s", w.Code, w.Body.String())
	}

	var pendingEmail sql.NullString
	if err := testDB.QueryRow("SELECT pending_email FROM users WHERE id = 'u_1'").Scan(&pendingEmail); err != nil {
		t.Fatalf("query user: %v", err)
	}
	if pendingEmail.Valid {
		t.Fatalf("expected no pending change to be set, got %q", pendingEmail.String)
	}
}

func TestRequestEmailChangeRejectsWrongPassword(t *testing.T) {
	oldDB := db
	testDB := setupEmailChangeTest(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	hash, _ := hashPassword("correct-password")
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'old@test.com', ?, 'Test User', TRUE)", hash); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"newEmail": "new@test.com", "currentPassword": "wrong-password"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/change", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_1"}))
	w := httptest.NewRecorder()
	handleRequestEmailChange(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for the wrong password, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRequestEmailChangeRejectsEmailAlreadyInUse(t *testing.T) {
	oldDB := db
	testDB := setupEmailChangeTest(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	hash, _ := hashPassword("correct-password")
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'old@test.com', ?, 'Test User', TRUE)", hash); err != nil {
		t.Fatalf("insert user 1: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_2', 'taken@test.com', ?, 'Other User', TRUE)", hash); err != nil {
		t.Fatalf("insert user 2: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"newEmail": "taken@test.com", "currentPassword": "correct-password"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/change", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_1"}))
	w := httptest.NewRecorder()
	handleRequestEmailChange(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for an email already in use, got %d: %s", w.Code, w.Body.String())
	}
}

func TestConfirmEmailChangeRejectsExpiredToken(t *testing.T) {
	oldDB := db
	testDB := setupEmailChangeTest(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'old@test.com', 'hash', 'Test User', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	expired := time.Now().Add(-1 * time.Hour)
	if _, err := testDB.Exec(
		"UPDATE users SET pending_email = ?, pending_email_token_hash = ?, pending_email_expires_at = ? WHERE id = 'u_1'",
		"new@test.com", hashToken("expired-token"), expired,
	); err != nil {
		t.Fatalf("set expired pending change: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"token": "expired-token"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/confirm", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleConfirmEmailChange(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an expired token, got %d: %s", w.Code, w.Body.String())
	}

	var liveEmail string
	if err := testDB.QueryRow("SELECT email FROM users WHERE id = 'u_1'").Scan(&liveEmail); err != nil {
		t.Fatalf("query user: %v", err)
	}
	if liveEmail != "old@test.com" {
		t.Fatalf("expected email unchanged after an expired-token confirm attempt, got %q", liveEmail)
	}
}

func TestConfirmEmailChangeRejectsRaceOnUniqueness(t *testing.T) {
	oldDB := db
	testDB := setupEmailChangeTest(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'old@test.com', 'hash', 'Test User', TRUE)"); err != nil {
		t.Fatalf("insert user 1: %v", err)
	}
	// Someone else claims the pending address before u_1 confirms.
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_2', 'contested@test.com', 'hash', 'Other User', TRUE)"); err != nil {
		t.Fatalf("insert user 2: %v", err)
	}
	if _, err := testDB.Exec(
		"UPDATE users SET pending_email = ?, pending_email_token_hash = ?, pending_email_expires_at = ? WHERE id = 'u_1'",
		"contested@test.com", hashToken("race-token"), time.Now().Add(1*time.Hour),
	); err != nil {
		t.Fatalf("set pending change: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"token": "race-token"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/confirm", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleConfirmEmailChange(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 when the pending address was claimed by someone else in the meantime, got %d: %s", w.Code, w.Body.String())
	}
}
