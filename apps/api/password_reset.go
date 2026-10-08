package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

const passwordResetTTL = 1 * time.Hour

// hashToken hashes a raw opaque token before it's stored, so a DB read
// (backup, replica, compromised query) never hands out something directly
// usable to act on an account — same reasoning as password_hash itself,
// though sha256 (not bcrypt) is enough here since the raw token is already
// 32 random bytes of entropy generated server-side, not a user-chosen value.
// Shared by password reset (this file) and email change (email_change.go).
func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// sendPasswordResetForUser invalidates any previous unused reset tokens for
// userID, issues a new one, and emails it. Shared by handleForgotPassword
// (unauthenticated, resolves userID by email) and
// handleRequestPasswordReset (authenticated, resolves userID from the JWT) —
// see product-memory 08.5 item G3 for why "reset" and "set a first password"
// (an OAuth-only account with no password_hash) are the same flow.
func sendPasswordResetForUser(userID, email, name string) {
	var hasPassword bool
	if err := db.QueryRow("SELECT password_hash IS NOT NULL FROM users WHERE id = ?", userID).Scan(&hasPassword); err != nil {
		log.Printf("[PASSWORD RESET] Failed to look up user %s: %v\n", userID, err)
		return
	}

	// Single-use per outstanding request: superseding a prior unused token
	// avoids a stale earlier email link staying valid alongside a new one.
	if _, err := db.Exec("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL", userID); err != nil {
		log.Printf("[PASSWORD RESET] Failed to invalidate prior tokens for %s: %v\n", userID, err)
	}

	rawToken := generateRandomHex(32)
	id := fmt.Sprintf("pwr_%d", time.Now().UnixNano())
	expiresAt := time.Now().Add(passwordResetTTL)

	if _, err := db.Exec(
		"INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
		id, userID, hashToken(rawToken), expiresAt,
	); err != nil {
		log.Printf("[PASSWORD RESET] Failed to insert reset token for %s: %v\n", userID, err)
		return
	}

	resetLink := fmt.Sprintf("%s/reset-password?token=%s", oauthFrontendBase(), rawToken)
	go func() {
		if err := emailSender.SendPasswordResetEmail(email, validateEmailContentName(name), resetLink, hasPassword); err != nil {
			log.Printf("[EMAIL] Failed to send password reset email to %s: %v\n", email, err)
		}
	}()
}

// POST /api/auth/forgot — always responds 200 with the same generic message
// regardless of whether the email matched an account, to avoid leaking
// which emails are registered (product-memory 08.5 item G3's explicit spec).
func handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	if !forgotLimiter.Allow(ClientIP(r)) {
		http.Error(w, "Too many requests. Please wait a few minutes before trying again.", http.StatusTooManyRequests)
		return
	}

	var payload struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	email := strings.TrimSpace(strings.ToLower(payload.Email))
	if email != "" {
		var userID, name string
		err := db.QueryRow("SELECT id, name FROM users WHERE email = ?", email).Scan(&userID, &name)
		if err == nil {
			sendPasswordResetForUser(userID, email, name)
		} else if err != sql.ErrNoRows {
			log.Printf("[PASSWORD RESET] Lookup failed for forgot-password request: %v\n", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"message": "If an account exists for that email, we've sent a link to reset or set your password.",
	})
}

// GET /api/auth/reset/{token} — lets the reset page check a token's
// validity (and whether the account already has a password, to choose
// "Reset your password" vs "Set a password" copy) before rendering the
// form, without that page itself needing to guess or the caller needing to
// be authenticated (they're not signed in yet — that's the whole point).
func handleCheckResetToken(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")

	var userID string
	var expiresAt time.Time
	err := db.QueryRow(
		"SELECT user_id, expires_at FROM password_resets WHERE token_hash = ? AND used_at IS NULL",
		hashToken(token),
	).Scan(&userID, &expiresAt)

	w.Header().Set("Content-Type", "application/json")
	if err != nil || time.Now().After(expiresAt) {
		_ = json.NewEncoder(w).Encode(map[string]bool{"valid": false})
		return
	}

	var hasPassword bool
	if err := db.QueryRow("SELECT password_hash IS NOT NULL FROM users WHERE id = ?", userID).Scan(&hasPassword); err != nil {
		_ = json.NewEncoder(w).Encode(map[string]bool{"valid": false})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":       true,
		"hasPassword": hasPassword,
	})
}

// POST /api/auth/reset — completes a reset (or first-time set) and, like
// signup, returns a fresh session token so the user lands signed in rather
// than being bounced back to a login form right after proving account
// ownership via the emailed link.
func handleResetPassword(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := validatePassword(payload.Password, "", ""); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var resetID, userID string
	var expiresAt time.Time
	err := db.QueryRow(
		"SELECT id, user_id, expires_at FROM password_resets WHERE token_hash = ? AND used_at IS NULL",
		hashToken(payload.Token),
	).Scan(&resetID, &userID, &expiresAt)
	if err == sql.ErrNoRows || (err == nil && time.Now().After(expiresAt)) {
		http.Error(w, "This link is invalid or has expired. Request a new one.", http.StatusBadRequest)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	hash, err := hashPassword(payload.Password)
	if err != nil {
		http.Error(w, "Failed to secure password: "+err.Error(), http.StatusInternalServerError)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Transaction failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hash, userID); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?", resetID); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to finalize: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var email, name string
	var emailVerified bool
	if err := db.QueryRow("SELECT email, name, email_verified FROM users WHERE id = ?", userID).Scan(&email, &name, &emailVerified); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	token, err := GenerateToken(userID, email, name, emailVerified)
	if err != nil {
		http.Error(w, "Failed to sign token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":             userID,
			"email":          email,
			"name":           name,
			"email_verified": emailVerified,
		},
	})
}

// POST /api/auth/password/request-reset — the authenticated equivalent of
// handleForgotPassword, used by the /account page's single "Change
// password" / "Set a password" action (product-memory 08.5 item G2): the
// caller is already proven to own the account via their JWT, so this skips
// re-typing an email and always targets the caller's own address.
func handleRequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if !forgotLimiter.Allow(user.ID) {
		http.Error(w, "Too many requests. Please wait a few minutes before trying again.", http.StatusTooManyRequests)
		return
	}

	sendPasswordResetForUser(user.ID, user.Email, user.Name)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"message": "Check your email for a link to continue.",
	})
}
