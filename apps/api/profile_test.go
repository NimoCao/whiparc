package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "modernc.org/sqlite"
)

func TestUpdateProfileNameAndAvatar(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'profile@test.com', 'hash', 'Old Name', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"name": "  New Name  ", "avatar_url": "https://example.com/avatar.png"})
	req := httptest.NewRequest(http.MethodPatch, "/api/auth/profile", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_1"}))
	w := httptest.NewRecorder()
	handleUpdateProfile(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Token string `json:"token"`
		User  struct {
			Name      string `json:"name"`
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Token == "" {
		t.Fatalf("expected a re-issued session token reflecting the new name")
	}
	// Trimmed, not the raw padded input.
	if resp.User.Name != "New Name" {
		t.Fatalf("expected trimmed name 'New Name', got %q", resp.User.Name)
	}
	if resp.User.AvatarURL != "https://example.com/avatar.png" {
		t.Fatalf("expected avatar_url to be set, got %q", resp.User.AvatarURL)
	}

	var name string
	var avatarURL sql.NullString
	if err := testDB.QueryRow("SELECT name, avatar_url FROM users WHERE id = 'u_1'").Scan(&name, &avatarURL); err != nil {
		t.Fatalf("query updated user: %v", err)
	}
	if name != "New Name" || avatarURL.String != "https://example.com/avatar.png" {
		t.Fatalf("expected persisted name/avatar_url to match, got name=%q avatar_url=%q", name, avatarURL.String)
	}
}

func TestUpdateProfilePartialUpdateLeavesOtherFieldAlone(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, avatar_url, email_verified) VALUES ('u_1', 'profile@test.com', 'hash', 'Original Name', 'https://example.com/original.png', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	// Only sending avatar_url — name must be left untouched.
	body, _ := json.Marshal(map[string]string{"avatar_url": "https://example.com/new.png"})
	req := httptest.NewRequest(http.MethodPatch, "/api/auth/profile", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_1"}))
	w := httptest.NewRecorder()
	handleUpdateProfile(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var name string
	var avatarURL sql.NullString
	if err := testDB.QueryRow("SELECT name, avatar_url FROM users WHERE id = 'u_1'").Scan(&name, &avatarURL); err != nil {
		t.Fatalf("query updated user: %v", err)
	}
	if name != "Original Name" {
		t.Fatalf("expected name to be untouched, got %q", name)
	}
	if avatarURL.String != "https://example.com/new.png" {
		t.Fatalf("expected avatar_url to be updated, got %q", avatarURL.String)
	}

	// An explicit empty string clears the avatar back to NULL.
	clearBody, _ := json.Marshal(map[string]string{"avatar_url": ""})
	clearReq := httptest.NewRequest(http.MethodPatch, "/api/auth/profile", bytes.NewReader(clearBody))
	clearReq = clearReq.WithContext(context.WithValue(clearReq.Context(), userContextKey, &TokenClaims{ID: "u_1"}))
	clearW := httptest.NewRecorder()
	handleUpdateProfile(clearW, clearReq)
	if clearW.Code != http.StatusOK {
		t.Fatalf("expected 200 clearing avatar, got %d: %s", clearW.Code, clearW.Body.String())
	}

	var avatarAfterClear sql.NullString
	if err := testDB.QueryRow("SELECT avatar_url FROM users WHERE id = 'u_1'").Scan(&avatarAfterClear); err != nil {
		t.Fatalf("query after clear: %v", err)
	}
	if avatarAfterClear.Valid {
		t.Fatalf("expected avatar_url to be cleared to NULL, got %q", avatarAfterClear.String)
	}
}

func TestUpdateProfileRejectsInvalidInput(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'profile@test.com', 'hash', 'Original Name', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	cases := []struct {
		name string
		body map[string]string
	}{
		{"empty name", map[string]string{"name": "   "}},
		{"javascript scheme avatar", map[string]string{"avatar_url": "javascript:alert(1)"}},
		{"not a url", map[string]string{"avatar_url": "not-a-url"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPatch, "/api/auth/profile", bytes.NewReader(body))
			req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_1"}))
			w := httptest.NewRecorder()
			handleUpdateProfile(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for %s, got %d: %s", tc.name, w.Code, w.Body.String())
			}
		})
	}

	var name string
	if err := testDB.QueryRow("SELECT name FROM users WHERE id = 'u_1'").Scan(&name); err != nil {
		t.Fatalf("query user: %v", err)
	}
	if name != "Original Name" {
		t.Fatalf("expected name to be unchanged after rejected updates, got %q", name)
	}
}
