package main

// Tests for deleting a project (DELETE /api/projects/{id}) and for the account
// deletion that follows it. SQLite runs with foreign_keys off, so ON DELETE
// CASCADE never fires: handleDeleteProject has to remove every dependent row
// itself or they are orphaned, and handleDeleteAccount then fails (HTTP 500)
// when it tries to reassign an orphaned canvas_states row to a team owner
// that no longer exists.

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// projectDependentTables lists every table that holds rows keyed by project_id
// and that deleteProjectsTx is responsible for cleaning up.
var projectDependentTables = []string{
	"canvas_states",
	"canvas_snapshots",
	"custom_nodes",
	"cloud_credentials",
	"paired_agents",
	"agent_pairing_tokens",
	"project_members",
	"project_join_requests",
}

// seedProjectDependents adds a row to each dependent table that
// seedTeamWithProject does not already cover, plus a template published from
// the project. creatorID owns the rows; memberID is the project member and
// join-request user.
func seedProjectDependents(t *testing.T, projectID, creatorID, memberID string) {
	t.Helper()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO custom_nodes (id, project_id, created_by, title, tech, code_type, raw_code) VALUES (?, ?, ?, 'N', 'Terraform', 'tf', 'x')", []any{"cn_" + projectID, projectID, creatorID}},
		{"INSERT INTO paired_agents (id, project_id, agent_id, name, public_key, encrypted_private_key, nonce, auth_tag, key_fingerprint, created_by) VALUES (?, ?, ?, 'a', 'pk', x'01', x'02', x'03', 'fp', ?)", []any{"pa_" + projectID, projectID, "agent_" + projectID, creatorID}},
		{"INSERT INTO agent_pairing_tokens (token_hash, project_id) VALUES (?, ?)", []any{"th_" + projectID, projectID}},
		{"INSERT INTO project_members (id, project_id, user_id, role, added_by) VALUES (?, ?, ?, 'EDITOR', ?)", []any{"pm_" + projectID, projectID, memberID, creatorID}},
		{"INSERT INTO project_join_requests (id, project_id, user_id) VALUES (?, ?, ?)", []any{"jr_" + projectID, projectID, memberID}},
		{"INSERT INTO templates (id, source_project_id, author_user_id, title, nodes_json, edges_json) VALUES (?, ?, ?, 'T', '[]', '[]')", []any{"tpl_" + projectID, projectID, creatorID}},
	} {
		if _, err := db.Exec(q.sql, q.args...); err != nil {
			t.Fatalf("seed %q: %v", q.sql, err)
		}
	}
}

func deleteProjectReq(projectID string) *http.Request {
	r := httptest.NewRequest(http.MethodDelete, "/api/projects/"+projectID, nil)
	r.SetPathValue("id", projectID)
	return r
}

func projectRows(t *testing.T, table, projectID string) int {
	t.Helper()
	return count(t, "SELECT COUNT(*) FROM "+table+" WHERE project_id = ?", projectID)
}

func TestDeleteProjectRemovesAllDependentRows(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")
	seedUser(t, "u_2", "b@test.com")
	seedTeamWithProject(t, "team_a", "u_1", "proj_gone", "u_1")
	seedProjectDependents(t, "proj_gone", "u_1", "u_2")
	// A second project that must be left alone.
	seedTeamWithProject(t, "team_b", "u_1", "proj_kept", "u_1")
	seedProjectDependents(t, "proj_kept", "u_1", "u_2")

	for _, table := range projectDependentTables {
		if projectRows(t, table, "proj_gone") != 1 {
			t.Fatalf("seed: expected one %s row for proj_gone", table)
		}
	}

	w := httptest.NewRecorder()
	handleDeleteProject(w, deleteProjectReq("proj_gone"))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if n := count(t, "SELECT COUNT(*) FROM projects WHERE id = 'proj_gone'"); n != 0 {
		t.Errorf("project row: expected it to be deleted, found %d", n)
	}
	for _, table := range projectDependentTables {
		if n := projectRows(t, table, "proj_gone"); n != 0 {
			t.Errorf("%s: expected 0 orphaned rows for the deleted project, found %d", table, n)
		}
		if n := projectRows(t, table, "proj_kept"); n != 1 {
			t.Errorf("%s: the other project's row must be untouched, found %d", table, n)
		}
	}

	// A template published from the project survives, detached from it.
	if n := count(t, "SELECT COUNT(*) FROM templates WHERE id = 'tpl_proj_gone' AND source_project_id IS NULL"); n != 1 {
		t.Error("template published from the deleted project should be kept with source_project_id cleared")
	}
	if n := count(t, "SELECT COUNT(*) FROM templates WHERE id = 'tpl_proj_kept' AND source_project_id = 'proj_kept'"); n != 1 {
		t.Error("the other project's template must keep its source_project_id")
	}
	if n := count(t, "SELECT COUNT(*) FROM projects WHERE id = 'proj_kept'"); n != 1 {
		t.Error("the other project must still exist")
	}
}

func TestDeleteAccountSucceedsAfterDeletingAProject(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")
	seedTeamWithProject(t, "team_a", "u_1", "proj_a", "u_1")

	w := httptest.NewRecorder()
	handleDeleteProject(w, deleteProjectReq("proj_a"))
	if w.Code != http.StatusOK {
		t.Fatalf("delete project: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	handleDeleteAccount(w, deleteReq("u_1", "correct-horse", "a@test.com"))
	if w.Code != http.StatusOK {
		t.Fatalf("delete account: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if n := count(t, "SELECT COUNT(*) FROM users WHERE id = 'u_1'"); n != 0 {
		t.Errorf("user row: expected it to be deleted, found %d", n)
	}
}

// Projects deleted before handleDeleteProject was fixed left orphaned rows
// behind. Those accounts must still be deletable, and the departing user's
// orphaned rows (which may include encrypted credentials) must not outlive
// them.
func TestDeleteAccountCleansUpOrphansLeftByEarlierProjectDeletes(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")
	seedUser(t, "u_other", "other@test.com")
	seedTeamWithProject(t, "team_a", "u_1", "proj_old", "u_1")
	seedProjectDependents(t, "proj_old", "u_1", "u_1")
	// Another user's orphaned canvas row, which this account's deletion must not touch.
	if _, err := db.Exec("INSERT INTO canvas_states (project_id, nodes_json, edges_json, viewport_json, updated_by) VALUES ('proj_old_other', '[]', '[]', '{}', 'u_other')"); err != nil {
		t.Fatal(err)
	}

	// What the old handler did: remove the project row and nothing else.
	if _, err := db.Exec("DELETE FROM projects WHERE id = 'proj_old'"); err != nil {
		t.Fatal(err)
	}
	if n := projectRows(t, "canvas_states", "proj_old"); n != 1 {
		t.Fatalf("setup: expected an orphaned canvas_states row, found %d", n)
	}

	w := httptest.NewRecorder()
	handleDeleteAccount(w, deleteReq("u_1", "correct-horse", "a@test.com"))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	for table, q := range map[string]string{
		"canvas_states":     "SELECT COUNT(*) FROM canvas_states WHERE updated_by = 'u_1'",
		"canvas_snapshots":  "SELECT COUNT(*) FROM canvas_snapshots WHERE created_by = 'u_1'",
		"custom_nodes":      "SELECT COUNT(*) FROM custom_nodes WHERE created_by = 'u_1'",
		"cloud_credentials": "SELECT COUNT(*) FROM cloud_credentials WHERE created_by = 'u_1'",
		"paired_agents":     "SELECT COUNT(*) FROM paired_agents WHERE created_by = 'u_1'",
	} {
		if n := count(t, q); n != 0 {
			t.Errorf("%s: expected the departing user's orphaned rows to be gone, found %d", table, n)
		}
	}
	if n := count(t, "SELECT COUNT(*) FROM canvas_states WHERE project_id = 'proj_old_other'"); n != 1 {
		t.Error("another user's orphaned row must not be touched")
	}
}
