package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "modernc.org/sqlite"
)

func TestUnlinkIdentityBlocksLastSignInMethod(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	// u_oauth_only has no password_hash (NULL) and exactly one linked
	// identity — this is the "last sign-in method" case the guard exists
	// for: unlinking it would leave the account with zero ways to sign in.
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_oauth_only', 'oauth@test.com', NULL, 'OAuth Only', TRUE)"); err != nil {
		t.Fatalf("insert u_oauth_only: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email) VALUES ('oid_1', 'u_oauth_only', 'github', 'gh123', 'oauth@test.com')"); err != nil {
		t.Fatalf("insert oauth identity: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/auth/identities/github", nil)
	req.SetPathValue("provider", "github")
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_oauth_only"}))
	w := httptest.NewRecorder()
	handleUnlinkIdentity(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 blocking removal of the last sign-in method, got %d: %s", w.Code, w.Body.String())
	}

	var count int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM oauth_identities WHERE user_id = 'u_oauth_only'").Scan(&count); err != nil {
		t.Fatalf("count identities: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected the identity to remain after a blocked unlink, got count=%d", count)
	}
}

func TestUnlinkIdentitySucceedsWithPasswordFallback(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	// u_has_password can still log in with a password after unlinking its
	// only identity, so the guard must not block this one.
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_has_password', 'pw@test.com', 'hash', 'Has Password', TRUE)"); err != nil {
		t.Fatalf("insert u_has_password: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email) VALUES ('oid_2', 'u_has_password', 'github', 'gh456', 'pw@test.com')"); err != nil {
		t.Fatalf("insert oauth identity: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/auth/identities/github", nil)
	req.SetPathValue("provider", "github")
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_has_password"}))
	w := httptest.NewRecorder()
	handleUnlinkIdentity(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 unlinking with a password fallback available, got %d: %s", w.Code, w.Body.String())
	}

	var count int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM oauth_identities WHERE user_id = 'u_has_password'").Scan(&count); err != nil {
		t.Fatalf("count identities: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected the identity to be removed, got count=%d", count)
	}
}

func TestGetIdentitiesReportsHasPassword(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_oauth_only', 'oauth@test.com', NULL, 'OAuth Only', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email) VALUES ('oid_1', 'u_oauth_only', 'google', 'g123', 'oauth@test.com')"); err != nil {
		t.Fatalf("insert oauth identity: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/identities", nil)
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_oauth_only"}))
	w := httptest.NewRecorder()
	handleGetIdentities(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		HasPassword bool           `json:"hasPassword"`
		Identities  []IdentityInfo `json:"identities"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.HasPassword {
		t.Fatalf("expected hasPassword=false for a NULL password_hash account")
	}
	if len(resp.Identities) != 1 || resp.Identities[0].Provider != "google" {
		t.Fatalf("expected 1 google identity, got %+v", resp.Identities)
	}
}
