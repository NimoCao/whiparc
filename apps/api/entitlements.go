package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

// Plan entitlements — product-memory 08.5 items F1/F3 and 08.1 item 3's
// "enforce hard limits on Free tier usage". teams.plan (kept current by the
// Paddle webhook, see billing.go) is the only input; every check reads it
// fresh from the DB, never from a token claim.
//
// Rules, as decided with the product owner:
//   - Free teams: at most 3 members (pending invites count) and 3 active
//     projects. Existing over-limit data is never deleted or locked — only
//     *new* additions are refused, so a downgrade can't destroy anything.
//   - Custom nodes can only be created by teams on a paid plan.
//   - Templates carry a real tier; forking a PRO template needs access to a
//     paid team.
//   - Nothing above applies unless enforcement is on (see
//     planEnforcementEnabled): a self-hosted install has no billing, so
//     every team there is FREE with no way to upgrade.
const (
	freeMaxMembers  = 3
	freeMaxProjects = 3
)

// planEnforcementEnabled: PLAN_ENFORCEMENT=true/false is an explicit
// override; otherwise limits apply exactly when billing is configured (a
// Paddle API key is set), i.e. when "upgrade" is something a user can
// actually do on this deployment.
func planEnforcementEnabled() bool {
	switch strings.ToLower(os.Getenv("PLAN_ENFORCEMENT")) {
	case "true", "1":
		return true
	case "false", "0":
		return false
	}
	return os.Getenv("PADDLE_API_KEY") != ""
}

func planIsPaid(plan string) bool {
	return plan == "PRO" || plan == "ENTERPRISE"
}

func teamPlan(teamID string) string {
	var plan string
	if err := db.QueryRow("SELECT plan FROM teams WHERE id = ?", teamID).Scan(&plan); err != nil {
		return "FREE"
	}
	return plan
}

// writePlanLimit replies 402 Payment Required — the one status here that
// means "valid request, blocked by plan" rather than a permissions problem
// (403 stays reserved for role/membership checks), so clients can offer an
// upgrade instead of a dead-end error.
func writePlanLimit(w http.ResponseWriter, msg string) {
	http.Error(w, msg, http.StatusPaymentRequired)
}

// teamMemberCount counts members, plus unexpired pending invites when
// includePending is set — an outstanding invite is a reserved seat, so
// without counting it a Free team could invite ten people and only find out
// at accept time.
func teamMemberCount(teamID string, includePending bool) int {
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM team_members WHERE team_id = ?", teamID).Scan(&n)
	if !includePending {
		return n
	}
	rows, err := db.Query("SELECT expires_at FROM invitations WHERE team_id = ? AND status = 'PENDING'", teamID)
	if err != nil {
		return n
	}
	defer rows.Close()
	now := time.Now()
	for rows.Next() {
		var exp time.Time
		if rows.Scan(&exp) == nil && now.Before(exp) {
			n++
		}
	}
	return n
}

func teamActiveProjectCount(teamID string) int {
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM projects WHERE team_id = ? AND archived_at IS NULL", teamID).Scan(&n)
	return n
}

// memberLimitMessage returns a non-empty refusal when adding one more
// member/invite to the team would exceed its plan. The counters swallow
// query errors (a failed count reads as 0), so a lookup hiccup fails open —
// same stance as the sandbox gate: it shouldn't block legitimate work.
func memberLimitMessage(teamID string, includePending bool) string {
	if !planEnforcementEnabled() || planIsPaid(teamPlan(teamID)) {
		return ""
	}
	if teamMemberCount(teamID, includePending) >= freeMaxMembers {
		return fmt.Sprintf("Free teams are limited to %d members (pending invites count). Upgrade to Pro to add more.", freeMaxMembers)
	}
	return ""
}

func projectLimitMessage(teamID string) string {
	if !planEnforcementEnabled() || planIsPaid(teamPlan(teamID)) {
		return ""
	}
	if teamActiveProjectCount(teamID) >= freeMaxProjects {
		return fmt.Sprintf("Free teams are limited to %d active projects. Archive a project or upgrade to Pro for unlimited projects.", freeMaxProjects)
	}
	return ""
}

func customNodeLimitMessage(projectID string) string {
	if !planEnforcementEnabled() {
		return ""
	}
	plan, ok := teamPlanForProject(projectID)
	if !ok || planIsPaid(plan) {
		return ""
	}
	return "Custom nodes are a Pro feature. Upgrade this project's team to create your own."
}

// proTemplateLimitMessage gates forking a PRO template on the caller having
// paid access through *any* team they belong to (bestPlanForUser), not just
// the personal team a fork lands in — someone on their employer's Pro team
// shouldn't be locked out of Pro templates because their own personal
// workspace is Free.
func proTemplateLimitMessage(tier, userID string) string {
	if tier != "PRO" || !planEnforcementEnabled() || planIsPaid(bestPlanForUser(userID)) {
		return ""
	}
	return "This is a Pro template. Upgrade a team you belong to in order to unlock it."
}

// GET /api/config — public. Lets the frontend know whether plan limits are
// live on this deployment, so a self-hosted install doesn't render Pro locks
// or upgrade prompts for rules that aren't being applied.
func handleGetConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"plan_enforcement": planEnforcementEnabled()})
}

// GET /api/projects/{id}/entitlements — what the project's owning team's
// plan allows, so UI like the custom-node paywall can decide up front
// instead of letting someone author a node only to be refused on save.
func handleGetProjectEntitlements(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	var teamID, plan string
	err := db.QueryRow("SELECT p.team_id, t.plan FROM projects p JOIN teams t ON t.id = p.team_id WHERE p.id = ?", projectID).Scan(&teamID, &plan)
	if err == sql.ErrNoRows {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"team_id":              teamID,
		"team_plan":            plan,
		"plan_enforcement":     planEnforcementEnabled(),
		"custom_nodes_allowed": customNodeLimitMessage(projectID) == "",
	})
}
