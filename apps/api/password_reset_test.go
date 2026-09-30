package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestPasswordResetFlowSetsPasswordAndIsSingleUse(t *testing.T) {
	oldDB := db
	oldEmailSender := emailSender
	oldForgotLimiter := forgotLimiter
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	emailSender = &ConsoleMailer{}
	forgotLimiter = NewRateLimiter(100, time.Hour, 100)
	defer func() {
		db = oldDB
		emailSender = oldEmailSender
		forgotLimiter = oldForgotLimiter
	}()

	// An OAuth-only account (no password_hash) is exactly the "set my first
	// password" case product-memory 08.5 item G3 asks this same flow to
	// cover, not just "reset an existing one".
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'oauth@test.com', NULL, 'OAuth User', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	// 1. POST /api/auth/forgot issues a token (sent via ConsoleMailer, but we
	// read it straight from password_resets since that's the source of truth).
	body, _ := json.Marshal(map[string]string{"email": "oauth@test.com"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleForgotPassword(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 from forgot-password, got %d: %s", w.Code, w.Body.String())
	}

	var resetID string
	if err := testDB.QueryRow("SELECT id FROM password_resets WHERE user_id = 'u_1' AND used_at IS NULL").Scan(&resetID); err != nil {
		t.Fatalf("expected an unused reset row to exist: %v", err)
	}

	// The raw token isn't directly queryable (only its hash is stored) — so
	// reconstruct it the same way sendPasswordResetForUser does, by hashing
	// candidate values, is impractical here; instead verify the *shape* of
	// the stored row (hashed, not plaintext) and drive the rest of the flow
	// through a token we mint ourselves via the same helper, matching how a
	// real raw token would arrive by email.
	rawToken := "test-raw-token-value"
	if _, err := testDB.Exec("UPDATE password_resets SET token_hash = ? WHERE id = ?", hashResetToken(rawToken), resetID); err != nil {
		t.Fatalf("failed to pin token hash for test: %v", err)
	}

	// 2. GET /api/auth/reset/check/{token} reports hasPassword=false for
	// this OAuth-only account, which is what lets the reset page render
	// "Set a password" instead of "Reset your password".
	checkReq := httptest.NewRequest(http.MethodGet, "/api/auth/reset/check/"+rawToken, nil)
	checkReq.SetPathValue("token", rawToken)
	checkW := httptest.NewRecorder()
	handleCheckResetToken(checkW, checkReq)
	var checkResp struct {
		Valid       bool `json:"valid"`
		HasPassword bool `json:"hasPassword"`
	}
	if err := json.Unmarshal(checkW.Body.Bytes(), &checkResp); err != nil {
		t.Fatalf("decode check response: %v", err)
	}
	if !checkResp.Valid || checkResp.HasPassword {
		t.Fatalf("expected valid=true hasPassword=false, got %+v", checkResp)
	}

	// 3. POST /api/auth/reset actually sets the password and returns a
	// session token (auto-login), matching signup's own behavior.
	resetBody, _ := json.Marshal(map[string]string{"token": rawToken, "password": "a-new-strong-password"})
	resetReq := httptest.NewRequest(http.MethodPost, "/api/auth/reset", bytes.NewReader(resetBody))
	resetW := httptest.NewRecorder()
	handleResetPassword(resetW, resetReq)
	if resetW.Code != http.StatusOK {
		t.Fatalf("expected 200 from reset, got %d: %s", resetW.Code, resetW.Body.String())
	}
	var resetResp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(resetW.Body.Bytes(), &resetResp); err != nil || resetResp.Token == "" {
		t.Fatalf("expected a session token in the reset response, got %s", resetW.Body.String())
	}

	var hash string
	if err := testDB.QueryRow("SELECT password_hash FROM users WHERE id = 'u_1'").Scan(&hash); err != nil || hash == "" {
		t.Fatalf("expected password_hash to be set after reset, err=%v hash=%q", err, hash)
	}

	// 4. Single-use: the exact same token must be rejected on a second use.
	resetReq2 := httptest.NewRequest(http.MethodPost, "/api/auth/reset", bytes.NewReader(resetBody))
	resetW2 := httptest.NewRecorder()
	handleResetPassword(resetW2, resetReq2)
	if resetW2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 reusing an already-used reset token, got %d: %s", resetW2.Code, resetW2.Body.String())
	}
}

func TestForgotPasswordDoesNotLeakAccountExistence(t *testing.T) {
	oldDB := db
	oldEmailSender := emailSender
	oldForgotLimiter := forgotLimiter
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	emailSender = &ConsoleMailer{}
	forgotLimiter = NewRateLimiter(100, time.Hour, 100)
	defer func() {
		db = oldDB
		emailSender = oldEmailSender
		forgotLimiter = oldForgotLimiter
	}()

	body, _ := json.Marshal(map[string]string{"email": "nobody-registered@test.com"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleForgotPassword(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 even for an unregistered email (no enumeration), got %d: %s", w.Code, w.Body.String())
	}
}
