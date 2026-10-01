package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

const emailChangeTTL = 24 * time.Hour

// POST /api/auth/email/change — starts an email change: requires the
// caller's current password (anti-hijack re-auth — a stolen session token
// alone can't redirect the account's email), validates and reserves the new
// address, and emails a confirmation link to it. The live `users.email`
// column is untouched until that link is clicked (handleConfirmEmailChange)
// — changing it immediately, before confirmation, would risk locking the
// user out on a typo. Also notifies the OLD address so an account-takeover
// attempt via a stolen session doesn't go unnoticed by the real owner.
func handleRequestEmailChange(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if !emailChangeLimiter.Allow(user.ID) {
		http.Error(w, "Too many requests. Please wait a few minutes before trying again.", http.StatusTooManyRequests)
		return
	}

	var payload struct {
		NewEmail        string `json:"newEmail"`
		CurrentPassword string `json:"currentPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	newEmail := strings.TrimSpace(strings.ToLower(payload.NewEmail))
	if newEmail == "" || payload.CurrentPassword == "" {
		http.Error(w, "New email and current password are required", http.StatusBadRequest)
		return
	}
	if err := ValidateEmail(newEmail); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var currentEmail, name string
	var hash sql.NullString
	if err := db.QueryRow("SELECT email, name, password_hash FROM users WHERE id = ?", user.ID).Scan(&currentEmail, &name, &hash); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// An OAuth-only account has nothing to re-authenticate with — rather than
	// invent a second re-auth path, point it at the existing "set a
	// password" flow (G3) first. Checked before anything else so the
	// response is unambiguous about what to do next.
	if !hash.Valid {
		http.Error(w, "Set a password first under Account Security before changing your email.", http.StatusBadRequest)
		return
	}
	if !checkPasswordHash(payload.CurrentPassword, hash.String) {
		http.Error(w, "Incorrect password", http.StatusUnauthorized)
		return
	}

	if newEmail == currentEmail {
		http.Error(w, "That's already your email", http.StatusBadRequest)
		return
	}

	var existingID string
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", newEmail).Scan(&existingID)
	if err == nil {
		http.Error(w, "That email is already in use", http.StatusConflict)
		return
	} else if err != sql.ErrNoRows {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	rawToken := generateRandomHex(32)
	expiresAt := time.Now().Add(emailChangeTTL)
	if _, err := db.Exec(
		"UPDATE users SET pending_email = ?, pending_email_token_hash = ?, pending_email_expires_at = ? WHERE id = ?",
		newEmail, hashToken(rawToken), expiresAt, user.ID,
	); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	confirmLink := fmt.Sprintf("%s/verify-email-change?token=%s", oauthFrontendBase(), rawToken)
	displayName := validateEmailContentName(name)
	go func() {
		if err := emailSender.SendEmailChangeVerification(newEmail, displayName, confirmLink); err != nil {
			log.Printf("[EMAIL] Failed to send email change verification to %s: %v\n", newEmail, err)
		}
	}()
	go func() {
		if err := emailSender.SendEmailChangeNotice(currentEmail, displayName, newEmail); err != nil {
			log.Printf("[EMAIL] Failed to send email change notice to %s: %v\n", currentEmail, err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"message": "Check your new email address for a confirmation link.",
	})
}

// POST /api/auth/email/confirm — completes a pending email change. Public
// (token-only, like password reset's confirm step) since the link may be
// opened in a different browser/session than the one that requested it.
func handleConfirmEmailChange(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	var userID, pendingEmail string
	var expiresAt time.Time
	err := db.QueryRow(
		"SELECT id, pending_email, pending_email_expires_at FROM users WHERE pending_email_token_hash = ?",
		hashToken(payload.Token),
	).Scan(&userID, &pendingEmail, &expiresAt)
	if err == sql.ErrNoRows || (err == nil && time.Now().After(expiresAt)) {
		http.Error(w, "This link is invalid or has expired. Request a new one from Account Security.", http.StatusBadRequest)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Re-check uniqueness at confirm time, not just at request time — the
	// address could have been claimed by someone else in the window between
	// requesting and confirming the change.
	var existingID string
	err = db.QueryRow("SELECT id FROM users WHERE email = ? AND id != ?", pendingEmail, userID).Scan(&existingID)
	if err == nil {
		http.Error(w, "That email is no longer available. Request a new change from Account Security.", http.StatusConflict)
		return
	} else if err != sql.ErrNoRows {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := db.Exec(
		"UPDATE users SET email = ?, email_verified = TRUE, pending_email = NULL, pending_email_token_hash = NULL, pending_email_expires_at = NULL WHERE id = ?",
		pendingEmail, userID,
	); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var name, plan string
	var emailVerified bool
	if err := db.QueryRow("SELECT name, plan, email_verified FROM users WHERE id = ?", userID).Scan(&name, &plan, &emailVerified); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// email rides in the JWT — re-issue so the new address takes effect
	// immediately in whatever session confirms it, same reasoning as
	// handleResetPassword/handleUpdateProfile.
	token, err := GenerateToken(userID, pendingEmail, name, plan, emailVerified)
	if err != nil {
		http.Error(w, "Failed to sign token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":             userID,
			"email":          pendingEmail,
			"name":           name,
			"plan":           plan,
			"email_verified": emailVerified,
		},
	})
}
