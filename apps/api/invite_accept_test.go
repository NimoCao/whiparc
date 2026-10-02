package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func seedInvite(t *testing.T, inviteeEmail string) {
	t.Helper()
	stmts := []string{
		"INSERT INTO users (id, email, name, email_verified) VALUES ('u_owner', 'owner@test.com', 'Owner', TRUE)",
		"INSERT INTO teams (id, name, slug, owner_id) VALUES ('t_1', 'Acme', 'acme', 'u_owner')",
		"INSERT INTO team_members (id, team_id, user_id, role) VALUES ('tm_o', 't_1', 'u_owner', 'OWNER')",
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("seed %q: %v", s, err)
		}
	}
	if _, err := db.Exec(
		"INSERT INTO invitations (id, team_id, email, role, token, status, invited_by, expires_at) VALUES ('inv_1', 't_1', ?, 'MEMBER', 'tok_1', 'PENDING', 'u_owner', ?)",
		inviteeEmail, time.Now().Add(time.Hour),
	); err != nil {
		t.Fatalf("seed invite: %v", err)
	}
}

func acceptAs(userID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/invites/tok_1/accept", nil)
	req.SetPathValue("token", "tok_1")
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: userID}))
	w := httptest.NewRecorder()
	handleAcceptInvite(w, req)
	return w
}

func TestAcceptInviteVerifiesEmailAndIsIdempotent(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	seedInvite(t, "new@test.com")
	// Signed up from the invite link: account exists but email is unverified.
	if _, err := db.Exec("INSERT INTO users (id, email, name, email_verified) VALUES ('u_new', 'New@Test.com', 'New', FALSE)"); err != nil {
		t.Fatal(err)
	}

	if w := acceptAs("u_new"); w.Code != http.StatusOK {
		t.Fatalf("first accept: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var verified bool
	if err := db.QueryRow("SELECT email_verified FROM users WHERE id = 'u_new'").Scan(&verified); err != nil || !verified {
		t.Fatalf("expected email auto-verified after accepting an invite sent to that address, got %v (err %v)", verified, err)
	}

	// A double-fired request must not turn a successful join into an error.
	if w := acceptAs("u_new"); w.Code != http.StatusOK {
		t.Fatalf("repeat accept: expected 200 (idempotent), got %d: %s", w.Code, w.Body.String())
	}
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM team_members WHERE team_id = 't_1' AND user_id = 'u_new'").Scan(&n)
	if n != 1 {
		t.Fatalf("expected exactly one membership row, got %d", n)
	}
}

func TestAcceptInviteRejectsWrongAccountWithoutVerifying(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	seedInvite(t, "new@test.com")
	if _, err := db.Exec("INSERT INTO users (id, email, name, email_verified) VALUES ('u_other', 'other@test.com', 'Other', FALSE)"); err != nil {
		t.Fatal(err)
	}

	if w := acceptAs("u_other"); w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a different email, got %d: %s", w.Code, w.Body.String())
	}
	var verified bool
	_ = db.QueryRow("SELECT email_verified FROM users WHERE id = 'u_other'").Scan(&verified)
	if verified {
		t.Fatal("a rejected accept must not verify the caller's email")
	}
}

func TestAcceptInviteStillRejectsConsumedInviteForOtherUser(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	seedInvite(t, "new@test.com")
	if _, err := db.Exec("INSERT INTO users (id, email, name, email_verified) VALUES ('u_new', 'new@test.com', 'New', TRUE)"); err != nil {
		t.Fatal(err)
	}
	if w := acceptAs("u_new"); w.Code != http.StatusOK {
		t.Fatalf("accept: %d %s", w.Code, w.Body.String())
	}
	// The member leaves; the consumed invite must not let them back in.
	if _, err := db.Exec("DELETE FROM team_members WHERE user_id = 'u_new'"); err != nil {
		t.Fatal(err)
	}
	if w := acceptAs("u_new"); w.Code != http.StatusGone {
		t.Fatalf("expected 410 for a consumed invite once the user is no longer a member, got %d", w.Code)
	}
}
