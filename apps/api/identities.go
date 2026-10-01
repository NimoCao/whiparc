package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// --- Link tickets ---
// A user already signed in on /account clicks "Connect GitHub" — that has
// to be a full-page navigation to /api/auth/{provider}/login (the provider
// round-trip needs one), but a plain <a href> can't carry an Authorization
// header. Putting the real JWT in that URL would violate the same rule
// oauth.go's own design notes document for the callback→frontend leg
// (challenge #7: never put a bearer token in a query string, browser
// history, or access logs). A link ticket is a single-use, 2-minute-TTL
// opaque value minted via an authenticated POST instead — exactly the
// oauthStates pattern below, just resolving to a user ID instead of a CSRF
// check.
var (
	linkTickets      = make(map[string]linkTicketEntry)
	linkTicketsMutex sync.Mutex
)

type linkTicketEntry struct {
	userID string
	expiry time.Time
}

func generateLinkTicket(userID string) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	ticket := hex.EncodeToString(b)

	linkTicketsMutex.Lock()
	linkTickets[ticket] = linkTicketEntry{userID: userID, expiry: time.Now().Add(2 * time.Minute)}
	linkTicketsMutex.Unlock()

	return ticket
}

func consumeLinkTicket(ticket string) (string, bool) {
	linkTicketsMutex.Lock()
	defer linkTicketsMutex.Unlock()

	entry, ok := linkTickets[ticket]
	if !ok {
		return "", false
	}
	delete(linkTickets, ticket) // single-use
	if time.Now().After(entry.expiry) {
		return "", false
	}
	return entry.userID, true
}

// POST /api/auth/link-ticket
func handleCreateLinkTicket(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ticket := generateLinkTicket(user.ID)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"ticket": ticket})
}

// --- Connected identities ---

type IdentityInfo struct {
	Provider string    `json:"provider"`
	Email    string    `json:"email"`
	LinkedAt time.Time `json:"linkedAt"`
}

// GET /api/auth/identities
func handleGetIdentities(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var hasPassword bool
	if err := db.QueryRow("SELECT password_hash IS NOT NULL FROM users WHERE id = ?", user.ID).Scan(&hasPassword); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	rows, err := db.Query("SELECT provider, email, created_at FROM oauth_identities WHERE user_id = ? ORDER BY created_at ASC", user.ID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	identities := []IdentityInfo{}
	for rows.Next() {
		var identity IdentityInfo
		var email sql.NullString
		if err := rows.Scan(&identity.Provider, &email, &identity.LinkedAt); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		identity.Email = email.String
		identities = append(identities, identity)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"hasPassword": hasPassword,
		"identities":  identities,
	})
}

// DELETE /api/auth/identities/{provider} — blocked when it would leave the
// account with zero sign-in methods (no password, and this the only linked
// identity), matching the same "don't let a user lock themselves out" rule
// every other destructive self-service action in this app already follows
// (e.g. E2's owner-protection on team removal).
func handleUnlinkIdentity(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	provider := r.PathValue("provider")

	var hasPassword bool
	if err := db.QueryRow("SELECT password_hash IS NOT NULL FROM users WHERE id = ?", user.ID).Scan(&hasPassword); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var identityCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM oauth_identities WHERE user_id = ?", user.ID).Scan(&identityCount); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if !hasPassword && identityCount <= 1 {
		http.Error(w, "Can't remove your last sign-in method — set a password first under Account Security.", http.StatusBadRequest)
		return
	}

	result, err := db.Exec("DELETE FROM oauth_identities WHERE user_id = ? AND provider = ?", user.ID, provider)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		http.Error(w, "No linked identity found for that provider", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
