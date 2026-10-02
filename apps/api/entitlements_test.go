package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func setupEntitlementsTest(t *testing.T) func() {
	t.Helper()
	oldDB := db
	testDB := setupAuthTestDB(t)
	testDB.SetMaxOpenConns(1)
	db = testDB
	t.Setenv("PADDLE_API_KEY", "")
	t.Setenv("PLAN_ENFORCEMENT", "true")

	stmts := []string{
		"INSERT INTO users (id, email, name, email_verified) VALUES ('u_owner', 'owner@test.com', 'Owner', TRUE)",
		"INSERT INTO teams (id, name, slug, owner_id) VALUES ('t_free', 'Free Co', 'free-co', 'u_owner')",
		"INSERT INTO teams (id, name, slug, owner_id, plan) VALUES ('t_pro', 'Pro Co', 'pro-co', 'u_owner', 'PRO')",
		"INSERT INTO team_members (id, team_id, user_id, role) VALUES ('tm_f', 't_free', 'u_owner', 'OWNER')",
		"INSERT INTO team_members (id, team_id, user_id, role) VALUES ('tm_p', 't_pro', 'u_owner', 'OWNER')",
	}
	for _, s := range stmts {
		if _, err := testDB.Exec(s); err != nil {
			t.Fatalf("seed %q: %v", s, err)
		}
	}
	return func() {
		testDB.Close()
		db = oldDB
	}
}

var projectSeq int

func addProjects(t *testing.T, teamID string, n int, archived bool) {
	t.Helper()
	for i := 0; i < n; i++ {
		q := "INSERT INTO projects (id, team_id, name, visibility, created_by) VALUES (?, ?, 'P', 'PRIVATE', 'u_owner')"
		if archived {
			q = "INSERT INTO projects (id, team_id, name, visibility, created_by, archived_at) VALUES (?, ?, 'P', 'PRIVATE', 'u_owner', CURRENT_TIMESTAMP)"
		}
		projectSeq++
		if _, err := db.Exec(q, fmt.Sprintf("proj_t%d", projectSeq), teamID); err != nil {
			t.Fatalf("insert project: %v", err)
		}
	}
}

func TestPlanEnforcementTogglesWithBillingConfig(t *testing.T) {
	t.Setenv("PLAN_ENFORCEMENT", "")
	t.Setenv("PADDLE_API_KEY", "")
	if planEnforcementEnabled() {
		t.Error("a deployment with no billing configured must not enforce limits (self-hosted stays uncapped)")
	}
	t.Setenv("PADDLE_API_KEY", "pdl_test")
	if !planEnforcementEnabled() {
		t.Error("configuring billing should turn enforcement on")
	}
	t.Setenv("PLAN_ENFORCEMENT", "false")
	if planEnforcementEnabled() {
		t.Error("explicit PLAN_ENFORCEMENT=false must win over a configured key")
	}
	t.Setenv("PADDLE_API_KEY", "")
	t.Setenv("PLAN_ENFORCEMENT", "true")
	if !planEnforcementEnabled() {
		t.Error("explicit PLAN_ENFORCEMENT=true must enable enforcement without a key")
	}
}

func TestMemberLimitCountsPendingInvitesAndSkipsPaidTeams(t *testing.T) {
	cleanup := setupEntitlementsTest(t)
	defer cleanup()

	if msg := memberLimitMessage("t_free", true); msg != "" {
		t.Fatalf("1 member of %d should be allowed to grow, got %q", freeMaxMembers, msg)
	}
	// Two unexpired pending invites + the owner = a full Free team.
	for i, email := range []string{"a@test.com", "b@test.com"} {
		if _, err := db.Exec(
			"INSERT INTO invitations (id, team_id, email, role, token, status, invited_by, expires_at) VALUES (?, 't_free', ?, 'MEMBER', ?, 'PENDING', 'u_owner', ?)",
			"inv_"+email, email, "tok_"+string(rune('a'+i)), time.Now().Add(time.Hour),
		); err != nil {
			t.Fatal(err)
		}
	}
	if msg := memberLimitMessage("t_free", true); msg == "" {
		t.Fatal("owner + 2 pending invites should fill a Free team")
	}
	if msg := memberLimitMessage("t_free", false); msg != "" {
		t.Fatalf("accept-time check counts only members; 1 member should pass, got %q", msg)
	}
	// An expired invite is not a reserved seat.
	if _, err := db.Exec("UPDATE invitations SET expires_at = ? WHERE id = 'inv_b@test.com'", time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if msg := memberLimitMessage("t_free", true); msg != "" {
		t.Fatalf("an expired invite must not count toward the cap, got %q", msg)
	}
	// Paid teams are never capped, however full.
	if _, err := db.Exec("INSERT INTO invitations (id, team_id, email, role, token, status, invited_by, expires_at) VALUES ('i1','t_pro','x@test.com','MEMBER','t1','PENDING','u_owner',?)", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if msg := memberLimitMessage("t_pro", true); msg != "" {
		t.Fatalf("PRO teams are uncapped, got %q", msg)
	}
}

func TestProjectLimitIgnoresArchivedAndPaidTeams(t *testing.T) {
	cleanup := setupEntitlementsTest(t)
	defer cleanup()

	addProjects(t, "t_free", 2, false)
	addProjects(t, "t_free", 5, true) // archived projects free their slot
	if msg := projectLimitMessage("t_free"); msg != "" {
		t.Fatalf("2 active projects (+5 archived) should be under the cap, got %q", msg)
	}
	addProjects(t, "t_free", 1, false)
	if msg := projectLimitMessage("t_free"); msg == "" {
		t.Fatal("3 active projects must reach the Free cap")
	}
	addProjects(t, "t_pro", 6, false)
	if msg := projectLimitMessage("t_pro"); msg != "" {
		t.Fatalf("PRO teams are uncapped, got %q", msg)
	}

	t.Setenv("PLAN_ENFORCEMENT", "false")
	if msg := projectLimitMessage("t_free"); msg != "" {
		t.Fatalf("with enforcement off nothing is capped, got %q", msg)
	}
}

func TestCreateProjectHandlerReturns402AtFreeLimit(t *testing.T) {
	cleanup := setupEntitlementsTest(t)
	defer cleanup()
	addProjects(t, "t_free", freeMaxProjects, false)

	req := httptest.NewRequest(http.MethodPost, "/api/projects", bytes.NewReader([]byte(`{"team_id":"t_free","name":"One too many"}`)))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_owner"}))
	w := httptest.NewRecorder()
	handleCreateProject(w, req)
	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402 at the Free project cap, got %d: %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/projects", bytes.NewReader([]byte(`{"team_id":"t_pro","name":"Fine"}`)))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &TokenClaims{ID: "u_owner"}))
	w = httptest.NewRecorder()
	handleCreateProject(w, req)
	if w.Code == http.StatusPaymentRequired {
		t.Fatalf("a PRO team must not be capped, got 402: %s", w.Body.String())
	}
}

func TestCustomNodeAndProTemplateGates(t *testing.T) {
	cleanup := setupEntitlementsTest(t)
	defer cleanup()
	addProjects(t, "t_free", 1, false)
	addProjects(t, "t_pro", 1, false)
	var freeProj, proProj string
	_ = db.QueryRow("SELECT id FROM projects WHERE team_id = 't_free'").Scan(&freeProj)
	_ = db.QueryRow("SELECT id FROM projects WHERE team_id = 't_pro'").Scan(&proProj)

	if customNodeLimitMessage(freeProj) == "" {
		t.Error("a Free team's project must be refused custom nodes")
	}
	if msg := customNodeLimitMessage(proProj); msg != "" {
		t.Errorf("a PRO team's project may create custom nodes, got %q", msg)
	}

	// u_owner belongs to a PRO team, so Pro templates are reachable via it.
	if msg := proTemplateLimitMessage("PRO", "u_owner"); msg != "" {
		t.Errorf("a member of any paid team can fork Pro templates, got %q", msg)
	}
	if _, err := db.Exec("INSERT INTO users (id, email, name, email_verified) VALUES ('u_free', 'free@test.com', 'Free', TRUE)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO team_members (id, team_id, user_id, role) VALUES ('tm_x', 't_free', 'u_free', 'MEMBER')"); err != nil {
		t.Fatal(err)
	}
	if proTemplateLimitMessage("PRO", "u_free") == "" {
		t.Error("a user on only Free teams must be refused a Pro template")
	}
	if msg := proTemplateLimitMessage("FREE", "u_free"); msg != "" {
		t.Errorf("FREE templates are never gated, got %q", msg)
	}
}

func TestSeededProTemplateTierAndMigration(t *testing.T) {
	cleanup := setupEntitlementsTest(t)
	defer cleanup()
	if err := seedOfficialTemplates(); err != nil {
		t.Fatal(err)
	}
	var pro, free int
	_ = db.QueryRow("SELECT COUNT(*) FROM templates WHERE tier = 'PRO'").Scan(&pro)
	_ = db.QueryRow("SELECT COUNT(*) FROM templates WHERE tier = 'FREE'").Scan(&free)
	if pro != len(proSeedTemplateTitles) || free == 0 {
		t.Fatalf("expected %d curated PRO seed(s) and the rest FREE, got pro=%d free=%d", len(proSeedTemplateTitles), pro, free)
	}
}
