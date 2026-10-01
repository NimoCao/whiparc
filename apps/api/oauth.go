package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// SOCIAL LOGIN (GOOGLE / GITHUB) — DESIGN NOTES & CHALLENGES
// ============================================================================
//
// Schema: OAuth identities live in their own `oauth_identities` table rather
// than being bolted onto `users` (see schema in main.go). This is the
// standard identity-provider pattern (Auth0, NextAuth, Devise, ...) — it
// means a future provider (Microsoft/SAML SSO, magic-link email, phone/OTP)
// is just another row shape, not another `users` migration, and a single
// user can link multiple providers to one account.
//
// Non-obvious traps hit while building this, worth keeping in mind for any
// future provider added the same way:
//
//  1. SQLite migration for nullable password_hash — SQLite has no
//     `ALTER TABLE ... ALTER COLUMN`, so relaxing the NOT NULL constraint on
//     an existing `users` table requires the classic rebuild dance (see
//     migrateUsersPasswordHashNullable below). Must be idempotent since it
//     runs on every boot.
//
//  2. Account linking / takeover risk — if someone already has a password
//     account at foo@gmail.com and later signs in with Google using that
//     same address, do we auto-link? Only safe when the provider asserts the
//     email is verified (Google always sets email_verified; GitHub's /user
//     endpoint does not guarantee this). Auto-linking on an *unverified*
//     email is an account-takeover vector — see findOrCreateOAuthUser.
//
//  3. GitHub's private/missing email — GET /user can return email: null if
//     the user has "keep my email private" enabled. Requires the
//     `user:email` scope and a follow-up call to GET /user/emails to find
//     the verified primary address (fetchGithubPrimaryEmail below); some
//     accounts genuinely have no usable email at all.
//
//  4. CSRF via the `state` parameter — the authorization-code flow requires
//     an unguessable, single-use `state` value generated before redirecting
//     to the provider and verified on callback (oauthStates below). Skipping
//     this opens the callback endpoint to session-fixation/CSRF.
//
//  5. Secrets must never land in docker-compose.yml — every other env var in
//     this repo (PORT, IS_DOCKER, VERBOSE) is harmless to commit; OAuth
//     Client ID/Secret are not. They're read via plain os.Getenv here,
//     matching the existing convention, but must be supplied via a
//     git-ignored .env + `env_file:` in docker-compose.yml, never inlined.
//
//  6. Redirect URI mismatch across environments — Google/GitHub OAuth apps
//     require an *exact* registered callback URL per environment. See
//     oauthRedirectBase/oauthFrontendBase, which mirror the existing
//     IS_DOCKER conditional pattern already used elsewhere in this file.
//
//  7. JWT hand-off after redirect — the callback is a full-page browser
//     redirect, not a fetch call, so the backend can't just return JSON.
//     Putting the JWT in the redirect URL's query string would leak it into
//     browser history and server access logs. Instead we redirect to a
//     frontend route with the token in a URL *fragment*
//     (/oauth/callback#token=...), which browsers never send to the server
//     or log anywhere.
//
//  8. sql.NullString for password_hash — once nullable, scanning
//     password_hash into a plain string panics/errors on NULL for
//     OAuth-only users who hit the password login form. handleLogin in
//     main.go scans into sql.NullString and rejects cleanly instead.
//
//  9. Duplicated team-bootstrapping logic — handleSignup creates a personal
//     team + OWNER membership inline; a new OAuth user needs the exact same
//     bootstrapping or ends up with no team to own projects under. Extracted
//     into createPersonalTeam (auth.go), shared by both paths.
//
// ============================================================================

// --- Provider config ---

type oauthProviderConfig struct {
	clientID     string
	clientSecret string
	authURL      string
	tokenURL     string
	userInfoURL  string
	scope        string
}

func getOAuthProviderConfig(provider string) (oauthProviderConfig, bool) {
	switch provider {
	case "google":
		return oauthProviderConfig{
			clientID:     os.Getenv("GOOGLE_CLIENT_ID"),
			clientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
			authURL:      "https://accounts.google.com/o/oauth2/v2/auth",
			tokenURL:     "https://oauth2.googleapis.com/token",
			userInfoURL:  "https://www.googleapis.com/oauth2/v3/userinfo",
			scope:        "openid email profile",
		}, true
	case "github":
		return oauthProviderConfig{
			clientID:     os.Getenv("GITHUB_CLIENT_ID"),
			clientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
			authURL:      "https://github.com/login/oauth/authorize",
			tokenURL:     "https://github.com/login/oauth/access_token",
			userInfoURL:  "https://api.github.com/user",
			scope:        "read:user user:email",
		}, true
	default:
		return oauthProviderConfig{}, false
	}
}

// oauthRedirectBase is where the OAuth provider redirects back to (this API
// server). See challenge #6 — must exactly match what's registered with the
// provider for the current environment.
func oauthRedirectBase() string {
	if v := os.Getenv("API_PUBLIC_URL"); v != "" {
		return v
	}
	return "http://localhost:8080"
}

// oauthFrontendBase is where we send the browser after a successful login.
func oauthFrontendBase() string {
	if v := os.Getenv("FRONTEND_URL"); v != "" {
		return v
	}
	return "http://localhost:3000"
}

// --- CSRF state store (challenge #4) ---
// In-memory, short-TTL — mirrors the existing `trackers`/`rooms` in-memory
// map pattern already used elsewhere in this file for run-tracking and
// workspace sync. Fine at this app's current scale; would need to move to
// the DB (or Redis) behind multiple API instances.
//
// Beyond the CSRF nonce itself, each entry also carries two things that
// need to survive the round-trip to the provider and back (product-memory
// 08.5 items G2/G5):
//   - redirect: where to send the browser after a normal login, so the
//     continuation a password-login already supports (e.g. resuming a
//     template fork) doesn't silently drop for OAuth.
//   - linkUserID: set only when this round-trip started from the /account
//     page's "Connect a provider" action (via a link ticket, see
//     identities.go) — turns handleOAuthCallback into a "link this identity
//     to my already-signed-in account" flow instead of a login/signup one.
var (
	oauthStates      = make(map[string]oauthStateEntry)
	oauthStatesMutex sync.Mutex
)

type oauthStateEntry struct {
	expiry     time.Time
	redirect   string
	linkUserID string
}

func generateOAuthState(redirect, linkUserID string) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	state := hex.EncodeToString(b)

	oauthStatesMutex.Lock()
	oauthStates[state] = oauthStateEntry{
		expiry:     time.Now().Add(10 * time.Minute),
		redirect:   redirect,
		linkUserID: linkUserID,
	}
	oauthStatesMutex.Unlock()

	return state
}

func consumeOAuthState(state string) (oauthStateEntry, bool) {
	oauthStatesMutex.Lock()
	defer oauthStatesMutex.Unlock()

	entry, ok := oauthStates[state]
	if !ok {
		return oauthStateEntry{}, false
	}
	delete(oauthStates, state) // single-use
	if time.Now().After(entry.expiry) {
		return oauthStateEntry{}, false
	}
	return entry, true
}

// isSafeRedirectPath rejects anything that isn't a plain same-origin path —
// no scheme, no "//" (protocol-relative), no backslash tricks — so a
// crafted redirect= query param can never turn this into an open redirect.
func isSafeRedirectPath(path string) bool {
	if path == "" || path[0] != '/' {
		return false
	}
	if len(path) > 1 && (path[1] == '/' || path[1] == '\\') {
		return false
	}
	if strings.Contains(path, "://") {
		return false
	}
	return true
}

// --- HTTP handlers ---

func handleOAuthLogin(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	cfg, ok := getOAuthProviderConfig(provider)
	if !ok {
		http.Error(w, "Unsupported provider", http.StatusNotFound)
		return
	}
	if cfg.clientID == "" {
		http.Error(w, provider+" sign-in is not configured on this server", http.StatusServiceUnavailable)
		return
	}

	redirect := r.URL.Query().Get("redirect")
	if redirect != "" && !isSafeRedirectPath(redirect) {
		redirect = ""
	}

	var linkUserID string
	if ticket := r.URL.Query().Get("link_ticket"); ticket != "" {
		userID, ok := consumeLinkTicket(ticket)
		if !ok {
			http.Error(w, "This link session has expired — go back to Account Security and try again.", http.StatusBadRequest)
			return
		}
		linkUserID = userID
	}

	state := generateOAuthState(redirect, linkUserID)
	redirectURI := oauthRedirectBase() + "/api/auth/" + provider + "/callback"

	params := url.Values{}
	params.Set("client_id", cfg.clientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("scope", cfg.scope)
	params.Set("state", state)
	if provider == "google" {
		params.Set("response_type", "code")
		params.Set("access_type", "online")
	}

	http.Redirect(w, r, cfg.authURL+"?"+params.Encode(), http.StatusTemporaryRedirect)
}

func handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	cfg, ok := getOAuthProviderConfig(provider)
	if !ok {
		http.Error(w, "Unsupported provider", http.StatusNotFound)
		return
	}

	stateEntry, ok := consumeOAuthState(r.URL.Query().Get("state"))
	if !ok {
		http.Error(w, "Invalid or expired OAuth state", http.StatusBadRequest)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Missing authorization code", http.StatusBadRequest)
		return
	}

	redirectURI := oauthRedirectBase() + "/api/auth/" + provider + "/callback"
	accessToken, err := exchangeOAuthCode(cfg, code, redirectURI)
	if err != nil {
		log.Printf("[OAUTH] Token exchange failed for %s: %v\n", provider, err)
		http.Error(w, "OAuth token exchange failed", http.StatusBadGateway)
		return
	}

	providerUserID, email, emailVerified, name, err := fetchOAuthUserInfo(cfg, provider, accessToken)
	if err != nil {
		log.Printf("[OAUTH] Failed to fetch user info from %s: %v\n", provider, err)
		http.Error(w, "Failed to fetch profile from provider", http.StatusBadGateway)
		return
	}

	// A link-flow round-trip (started from /account, see identities.go's
	// link tickets) attaches this provider identity to the already-signed-in
	// user instead of logging in/creating a new account — the person never
	// gets a new token here, they're already holding a valid one.
	if stateEntry.linkUserID != "" {
		errCode := linkOAuthIdentity(stateEntry.linkUserID, provider, providerUserID, email)
		redirectURL := oauthFrontendBase() + "/account?linked=" + provider
		if errCode != "" {
			redirectURL = oauthFrontendBase() + "/account?linkError=" + errCode
		}
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
	}

	user, err := findOrCreateOAuthUser(provider, providerUserID, email, emailVerified, name)
	if err != nil {
		log.Printf("[OAUTH] Failed to resolve user for %s: %v\n", provider, err)
		http.Error(w, "Failed to complete sign-in", http.StatusInternalServerError)
		return
	}

	token, err := GenerateToken(user.ID, user.Email, user.Name, user.EmailVerified)
	if err != nil {
		log.Printf("[OAUTH] Failed to sign token: %v\n", err)
		http.Error(w, "Failed to sign token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Challenge #7: hand off via URL fragment, never a query param. The
	// (already-validated-safe) redirect rides along the same way — a
	// fragment, so it's never sent to any server either.
	fragment := "token=" + url.QueryEscape(token)
	if stateEntry.redirect != "" {
		fragment += "&redirect=" + url.QueryEscape(stateEntry.redirect)
	}
	redirectURL := oauthFrontendBase() + "/oauth/callback#" + fragment
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// linkOAuthIdentity attaches a provider identity to an existing,
// already-authenticated user. Returns "" on success, or a short error code
// for the /account page to render: "already_linked" if that exact provider
// identity already belongs to a *different* account (never silently
// reassign it), "provider_linked" if the caller already has a *different*
// identity linked for this same provider (oauth_identities' own
// UNIQUE(user_id, provider) constraint), or "" treated as success if it's
// already linked to this same account (idempotent, not an error).
func linkOAuthIdentity(userID, provider, providerUserID, email string) string {
	var existingUserID string
	err := db.QueryRow(
		"SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?",
		provider, providerUserID,
	).Scan(&existingUserID)
	if err == nil {
		if existingUserID == userID {
			return ""
		}
		return "already_linked"
	}
	if err != sql.ErrNoRows {
		log.Printf("[OAUTH] Link lookup failed for %s: %v\n", provider, err)
		return "link_failed"
	}

	var alreadyHasProvider bool
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM oauth_identities WHERE user_id = ? AND provider = ?)", userID, provider).Scan(&alreadyHasProvider); err != nil {
		log.Printf("[OAUTH] Link provider-check failed: %v\n", err)
		return "link_failed"
	}
	if alreadyHasProvider {
		return "provider_linked"
	}

	identityID := fmt.Sprintf("oid_%d", time.Now().UnixNano())
	if _, err := db.Exec(
		"INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email) VALUES (?, ?, ?, ?, ?)",
		identityID, userID, provider, providerUserID, email,
	); err != nil {
		log.Printf("[OAUTH] Failed to link identity: %v\n", err)
		return "link_failed"
	}
	return ""
}

// --- Provider HTTP calls ---

func exchangeOAuthCode(cfg oauthProviderConfig, code, redirectURI string) (string, error) {
	form := url.Values{}
	form.Set("client_id", cfg.clientID)
	form.Set("client_secret", cfg.clientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("grant_type", "authorization_code")

	req, err := http.NewRequest("POST", cfg.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json") // GitHub returns form-encoded without this

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("unexpected token response: %s", string(body))
	}
	if result.Error != "" {
		return "", fmt.Errorf("%s: %s", result.Error, result.ErrorDesc)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("provider returned no access token")
	}

	return result.AccessToken, nil
}

func fetchOAuthUserInfo(cfg oauthProviderConfig, provider, accessToken string) (providerUserID, email string, emailVerified bool, name string, err error) {
	switch provider {
	case "google":
		return fetchGoogleUserInfo(cfg, accessToken)
	case "github":
		return fetchGithubUserInfo(cfg, accessToken)
	default:
		return "", "", false, "", fmt.Errorf("unsupported provider %s", provider)
	}
}

func fetchGoogleUserInfo(cfg oauthProviderConfig, accessToken string) (string, string, bool, string, error) {
	req, err := http.NewRequest("GET", cfg.userInfoURL, nil)
	if err != nil {
		return "", "", false, "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", false, "", err
	}
	defer resp.Body.Close()

	var result struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", false, "", err
	}
	if result.Sub == "" {
		return "", "", false, "", fmt.Errorf("missing subject id in Google userinfo response")
	}

	name := result.Name
	if name == "" {
		name = result.Email
	}

	return result.Sub, strings.ToLower(strings.TrimSpace(result.Email)), result.EmailVerified, name, nil
}

func fetchGithubUserInfo(cfg oauthProviderConfig, accessToken string) (string, string, bool, string, error) {
	req, err := http.NewRequest("GET", cfg.userInfoURL, nil)
	if err != nil {
		return "", "", false, "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", false, "", err
	}
	defer resp.Body.Close()

	var result struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", false, "", err
	}
	if result.ID == 0 {
		return "", "", false, "", fmt.Errorf("missing user id in GitHub userinfo response")
	}

	providerUserID := fmt.Sprintf("%d", result.ID)
	name := result.Name
	if name == "" {
		name = result.Login
	}

	email := strings.ToLower(strings.TrimSpace(result.Email))
	emailVerified := false
	if email != "" {
		// GitHub only ever populates /user's email field with the public,
		// already-verified primary address — if it's private, this is null
		// rather than an unverified value, so a non-empty value here is safe.
		emailVerified = true
	} else {
		// Challenge #3: private email setting. Fall back to /user/emails.
		fallbackEmail, verified, ferr := fetchGithubPrimaryEmail(accessToken)
		if ferr != nil {
			log.Printf("[OAUTH] GitHub email fallback lookup failed: %v\n", ferr)
		} else {
			email = fallbackEmail
			emailVerified = verified
		}
	}

	return providerUserID, email, emailVerified, name, nil
}

func fetchGithubPrimaryEmail(accessToken string) (string, bool, error) {
	req, err := http.NewRequest("GET", "https://api.github.com/user/emails", nil)
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()

	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&emails); err != nil {
		return "", false, err
	}

	for _, e := range emails {
		if e.Primary && e.Verified {
			return strings.ToLower(strings.TrimSpace(e.Email)), true, nil
		}
	}
	for _, e := range emails {
		if e.Verified {
			return strings.ToLower(strings.TrimSpace(e.Email)), true, nil
		}
	}

	// No verified email at all — caller proceeds with an empty email;
	// findOrCreateOAuthUser synthesizes a placeholder in that case.
	return "", false, nil
}

// --- Find-or-create ---

type oauthResolvedUser struct {
	ID            string
	Email         string
	Name          string
	EmailVerified bool
}

// findOrCreateOAuthUser resolves a provider identity to an app user,
// creating a new account (+ personal team) on first sign-in. See challenge
// #2 for why linking onto an existing account requires a verified email.
func findOrCreateOAuthUser(provider, providerUserID, email string, emailVerified bool, name string) (*oauthResolvedUser, error) {
	var existingUserID string
	err := db.QueryRow(
		"SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?",
		provider, providerUserID,
	).Scan(&existingUserID)
	if err == nil {
		return loadOAuthResolvedUser(existingUserID)
	}
	if err != sql.ErrNoRows {
		return nil, err
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var userID string
	if emailVerified && email != "" {
		err = tx.QueryRow("SELECT id FROM users WHERE email = ?", email).Scan(&userID)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
	}

	if userID == "" {
		userID = fmt.Sprintf("usr_%d", time.Now().UnixNano())
		resolvedName := name
		if resolvedName == "" {
			resolvedName = email
		}
		resolvedEmail := email
		if resolvedEmail == "" {
			// No usable email at all (private GitHub email with no verified
			// fallback) — synthesize a placeholder so the UNIQUE/NOT NULL
			// constraints on users.email still hold. This account can only
			// ever sign in via this same OAuth identity, never via password
			// or a different provider claiming to be this address.
			resolvedEmail = fmt.Sprintf("%s_%s@users.noreply.whiparc", provider, providerUserID)
		}

		if _, err = tx.Exec(
			"INSERT INTO users (id, email, password_hash, name, email_verified) VALUES (?, ?, NULL, ?, ?)",
			userID, resolvedEmail, resolvedName, true,
		); err != nil {
			return nil, fmt.Errorf("failed to create user: %w", err)
		}

		if err := createPersonalTeam(tx, userID, resolvedName); err != nil {
			return nil, err
		}
	}

	identityID := fmt.Sprintf("oid_%d", time.Now().UnixNano())
	if _, err = tx.Exec(
		"INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email) VALUES (?, ?, ?, ?, ?)",
		identityID, userID, provider, providerUserID, email,
	); err != nil {
		return nil, fmt.Errorf("failed to link identity: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return loadOAuthResolvedUser(userID)
}

func loadOAuthResolvedUser(userID string) (*oauthResolvedUser, error) {
	var u oauthResolvedUser
	err := db.QueryRow("SELECT id, email, name, email_verified FROM users WHERE id = ?", userID).Scan(&u.ID, &u.Email, &u.Name, &u.EmailVerified)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// --- Schema migration ---

// migrateUsersPasswordHashNullable rebuilds the `users` table so that
// password_hash can be NULL for OAuth-only accounts. SQLite has no
// `ALTER TABLE ... ALTER COLUMN`, so relaxing a NOT NULL constraint requires
// the classic rebuild dance: create the new shape, copy rows across, drop
// the old table, rename. Idempotent — checks PRAGMA table_info first, so
// it's a no-op on every boot after the first successful run (challenge #1).
func migrateUsersPasswordHashNullable() error {
	rows, err := db.Query("PRAGMA table_info(users)")
	if err != nil {
		return err
	}
	defer rows.Close()

	alreadyNullable := false
	for rows.Next() {
		var cid, notNull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			return err
		}
		if name == "password_hash" && notNull == 0 {
			alreadyNullable = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if alreadyNullable {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		CREATE TABLE users_new (
			id TEXT PRIMARY KEY,
			email TEXT UNIQUE NOT NULL,
			password_hash TEXT,
			name TEXT NOT NULL,
			plan TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO', 'ENTERPRISE')),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`); err != nil {
		return fmt.Errorf("create users_new: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO users_new SELECT id, email, password_hash, name, plan, created_at FROM users;`); err != nil {
		return fmt.Errorf("copy users rows: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE users;`); err != nil {
		return fmt.Errorf("drop old users: %w", err)
	}
	if _, err := tx.Exec(`ALTER TABLE users_new RENAME TO users;`); err != nil {
		return fmt.Errorf("rename users_new: %w", err)
	}

	log.Println("[DB] Migrated users.password_hash to nullable for OAuth-only accounts")
	return tx.Commit()
}
