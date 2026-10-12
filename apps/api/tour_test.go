package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func meTourCompleted(t *testing.T, userID string) bool {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: userID}))
	w := httptest.NewRecorder()
	handleMe(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("me: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		TourCompleted bool `json:"tour_completed"`
		User          struct {
			TourCompleted bool `json:"tour_completed"`
		} `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode me: %v", err)
	}
	if resp.TourCompleted != resp.User.TourCompleted {
		t.Fatalf("top-level and nested tour_completed disagree: %v vs %v", resp.TourCompleted, resp.User.TourCompleted)
	}
	return resp.TourCompleted
}

func TestCompleteTourIsPerUserAndIdempotent(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	for _, id := range []string{"u_1", "u_2"} {
		if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES (?, ?, 'hash', 'Tester', TRUE)", id, id+"@test.com"); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}

	if meTourCompleted(t, "u_1") {
		t.Fatalf("a new account must start with the tour not completed")
	}

	complete := func(userID string) {
		req := httptest.NewRequest(http.MethodPatch, "/api/auth/tour", nil)
		req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: userID}))
		w := httptest.NewRecorder()
		handleCompleteTour(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("complete tour: expected 200, got %d: %s", w.Code, w.Body.String())
		}
	}

	complete("u_1")
	if !meTourCompleted(t, "u_1") {
		t.Fatalf("expected tour_completed after completing it")
	}
	if meTourCompleted(t, "u_2") {
		t.Fatalf("completing the tour for one user must not affect another")
	}

	// A second report (e.g. from another device) keeps the first timestamp.
	var first string
	if err := testDB.QueryRow("SELECT CAST(tour_completed_at AS TEXT) FROM users WHERE id = 'u_1'").Scan(&first); err != nil {
		t.Fatalf("read first timestamp: %v", err)
	}
	complete("u_1")
	var second string
	if err := testDB.QueryRow("SELECT CAST(tour_completed_at AS TEXT) FROM users WHERE id = 'u_1'").Scan(&second); err != nil {
		t.Fatalf("read second timestamp: %v", err)
	}
	if first != second {
		t.Fatalf("expected the original completion time to be kept, got %q then %q", first, second)
	}
}

func TestCompleteTourRequiresAuth(t *testing.T) {
	req := httptest.NewRequest(http.MethodPatch, "/api/auth/tour", nil)
	w := httptest.NewRecorder()
	handleCompleteTour(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a session, got %d", w.Code)
	}
}
