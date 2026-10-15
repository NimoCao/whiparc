package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func meTours(t *testing.T, userID string) (dashboard, workspace bool) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: userID}))
	w := httptest.NewRecorder()
	handleMe(w, req)
	var resp struct {
		TourCompleted          bool `json:"tour_completed"`
		WorkspaceTourCompleted bool `json:"workspace_tour_completed"`
		User                   struct {
			WorkspaceTourCompleted bool `json:"workspace_tour_completed"`
		} `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode me: %v", err)
	}
	if resp.WorkspaceTourCompleted != resp.User.WorkspaceTourCompleted {
		t.Fatalf("top-level and nested workspace_tour_completed disagree")
	}
	return resp.TourCompleted, resp.WorkspaceTourCompleted
}

func patchTour(userID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPatch, "/api/auth/tour", strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: userID}))
	w := httptest.NewRecorder()
	handleCompleteTour(w, req)
	return w
}

func TestCompleteTourToursAreIndependent(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'u1@test.com', 'hash', 'Tester', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	if d, w := meTours(t, "u_1"); d || w {
		t.Fatalf("a new account must start with neither tour completed, got dashboard=%v workspace=%v", d, w)
	}

	if w := patchTour("u_1", `{"tour":"workspace"}`); w.Code != http.StatusOK {
		t.Fatalf("workspace tour: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if d, w := meTours(t, "u_1"); d || !w {
		t.Fatalf("completing the workspace tour must not complete the dashboard one, got dashboard=%v workspace=%v", d, w)
	}

	// An empty body (clients that predate the workspace tour) and an explicit
	// "dashboard" both mean the dashboard tour.
	if w := patchTour("u_1", ``); w.Code != http.StatusOK {
		t.Fatalf("empty body: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if d, w := meTours(t, "u_1"); !d || !w {
		t.Fatalf("expected both tours completed, got dashboard=%v workspace=%v", d, w)
	}
	if w := patchTour("u_1", `{"tour":"dashboard"}`); w.Code != http.StatusOK {
		t.Fatalf("explicit dashboard: expected 200, got %d", w.Code)
	}
}

func TestCompleteTourRejectsUnknownTour(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES ('u_1', 'u1@test.com', 'hash', 'Tester', TRUE)"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	for _, body := range []string{`{"tour":"tour_completed_at"}`, `{"tour":"nope"}`, `not json`} {
		if w := patchTour("u_1", body); w.Code != http.StatusBadRequest {
			t.Fatalf("body %q: expected 400, got %d", body, w.Code)
		}
	}
	if d, w := meTours(t, "u_1"); d || w {
		t.Fatalf("a rejected request must not complete anything, got dashboard=%v workspace=%v", d, w)
	}
}
