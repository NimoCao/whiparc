package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "modernc.org/sqlite"
)

func TestActivityEventInsertAndScope(t *testing.T) {
	oldDB := db
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	defer func() { db = oldDB }()

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name) VALUES ('u_member', 'member@test.com', 'hash', 'Member')"); err != nil {
		t.Fatalf("insert u_member: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name) VALUES ('u_outsider', 'outsider@test.com', 'hash', 'Outsider')"); err != nil {
		t.Fatalf("insert u_outsider: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO teams (id, name, slug, owner_id) VALUES ('team_1', 'Team One', 'team-one', 'u_member')"); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO projects (id, team_id, name, visibility, created_by) VALUES ('proj_1', 'team_1', 'demo', 'PRIVATE', 'u_member')"); err != nil {
		t.Fatalf("insert project: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO project_members (id, project_id, user_id, role, added_by) VALUES ('pmem_1', 'proj_1', 'u_member', 'ADMIN', 'u_member')"); err != nil {
		t.Fatalf("insert project_member: %v", err)
	}

	insertActivityEvent("proj_1", "u_member", "project.created", map[string]interface{}{"name": "demo"})

	// team_id must be derived from the project, not left NULL, when the
	// project actually has one.
	var teamID, kind string
	if err := testDB.QueryRow("SELECT team_id, kind FROM activity_events WHERE project_id = 'proj_1'").Scan(&teamID, &kind); err != nil {
		t.Fatalf("query inserted event: %v", err)
	}
	if teamID != "team_1" || kind != "project.created" {
		t.Fatalf("expected team_id=team_1 kind=project.created, got team_id=%q kind=%q", teamID, kind)
	}

	// The project's own ADMIN member sees the event.
	req := httptest.NewRequest(http.MethodGet, "/api/activity", nil)
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_member"}))
	w := httptest.NewRecorder()
	handleGetActivity(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for member, got %d: %s", w.Code, w.Body.String())
	}
	var memberEvents []ActivityEvent
	if err := json.Unmarshal(w.Body.Bytes(), &memberEvents); err != nil {
		t.Fatalf("decode member response: %v", err)
	}
	if len(memberEvents) != 1 || memberEvents[0].Kind != "project.created" {
		t.Fatalf("expected 1 project.created event for member, got %+v", memberEvents)
	}

	// A user with no relationship to the (PRIVATE) project sees nothing —
	// proves handleGetActivity's scoping actually filters, not just decorates.
	req2 := httptest.NewRequest(http.MethodGet, "/api/activity", nil)
	req2 = req2.WithContext(context.WithValue(req2.Context(), userContextKey, &TokenClaims{ID: "u_outsider"}))
	w2 := httptest.NewRecorder()
	handleGetActivity(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 for outsider, got %d: %s", w2.Code, w2.Body.String())
	}
	var outsiderEvents []ActivityEvent
	if err := json.Unmarshal(w2.Body.Bytes(), &outsiderEvents); err != nil {
		t.Fatalf("decode outsider response: %v", err)
	}
	if len(outsiderEvents) != 0 {
		t.Fatalf("expected 0 events visible to an outsider of a PRIVATE project, got %+v", outsiderEvents)
	}
}
