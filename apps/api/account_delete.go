package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// Subscription states in which deleting the account would orphan a live
// paid subscription (the provider keeps billing a customer whose team no
// longer exists). canceled/expired/empty are safe.
var liveSubscriptionStatuses = map[string]bool{
	"active": true, "trialing": true, "past_due": true, "paused": true,
}

type accountDeleteBlocker struct {
	TeamID   string `json:"team_id"`
	TeamName string `json:"team_name"`
	Reason   string `json:"reason"`
}

// deleteProjectsTx removes projects and everything hanging off them by hand.
// The schema declares ON DELETE CASCADE, but SQLite (this codebase's default
// backend) runs with foreign_keys off, so relying on cascades would orphan
// encrypted credentials, agent key material and canvases there — the
// explicit deletes make behavior identical on SQLite and Postgres.
func deleteProjectsTx(tx *dbTx, projectIDs []string) error {
	for _, id := range projectIDs {
		for _, stmt := range []string{
			"DELETE FROM canvas_states WHERE project_id = ?",
			"DELETE FROM canvas_snapshots WHERE project_id = ?",
			"DELETE FROM custom_nodes WHERE project_id = ?",
			"DELETE FROM cloud_credentials WHERE project_id = ?",
			"DELETE FROM paired_agents WHERE project_id = ?",
			"DELETE FROM agent_pairing_tokens WHERE project_id = ?",
			"DELETE FROM project_members WHERE project_id = ?",
			"DELETE FROM project_join_requests WHERE project_id = ?",
			"UPDATE templates SET source_project_id = NULL WHERE source_project_id = ?",
			"DELETE FROM projects WHERE id = ?",
		} {
			if _, err := tx.Exec(stmt, id); err != nil {
				return fmt.Errorf("%s: %w", strings.Fields(stmt)[2], err)
			}
		}
	}
	return nil
}

// DELETE /api/auth/account — permanently deletes the caller's account.
//
// Safety rails, in order:
//  1. Re-authentication: the current password AND the account email typed
//     out (a stolen session token alone cannot destroy an account, and a
//     misclick cannot either). OAuth-only accounts must set a password first,
//     the same rule email change uses, rather than inventing a weaker path.
//  2. Rate limited per user — this endpoint is a password oracle otherwise.
//  3. Refuses (409, with a machine-readable list) when the user owns a team
//     that still has other members (there is no ownership-transfer flow yet,
//     so deleting would strand or destroy their work) or that has a live paid
//     subscription (the provider would keep charging a deleted team).
//
// What is deleted: the user, their personal/solo teams with all projects,
// credentials and agents under them, their marketplace templates, memberships,
// identities, reset tokens and avatar. What is kept but detached: rows they
// created inside teams owned by someone else (projects, canvases, snapshots,
// custom nodes, credentials, agents) are reassigned to that team's owner so
// teammates lose nothing, and audit events keep their row with the actor
// cleared.
func handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if !deleteAcctLimiter.Allow(user.ID) {
		http.Error(w, "Too many attempts. Please wait a few minutes before trying again.", http.StatusTooManyRequests)
		return
	}

	var payload struct {
		Password     string `json:"password"`
		ConfirmEmail string `json:"confirm_email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	var email string
	var hash sql.NullString
	if err := db.QueryRow("SELECT email, password_hash FROM users WHERE id = ?", user.ID).Scan(&email, &hash); err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}
	if !hash.Valid {
		http.Error(w, "Set a password first under Account Security before deleting your account.", http.StatusBadRequest)
		return
	}
	if !strings.EqualFold(strings.TrimSpace(payload.ConfirmEmail), email) {
		http.Error(w, "Type your account email exactly to confirm deletion", http.StatusBadRequest)
		return
	}
	if payload.Password == "" || !checkPasswordHash(payload.Password, hash.String) {
		http.Error(w, "Incorrect password", http.StatusUnauthorized)
		return
	}

	// Teams this user owns decide whether deletion may proceed.
	type ownedTeam struct {
		id, name        string
		otherMembers    int
		subscriptionID  sql.NullString
		subscriptionSta sql.NullString
	}
	var owned []ownedTeam
	rows, err := db.Query(`
		SELECT t.id, t.name, t.billing_subscription_id, t.subscription_status,
		       (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id AND m.user_id <> ?)
		FROM teams t WHERE t.owner_id = ?`, user.ID, user.ID)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	for rows.Next() {
		var t ownedTeam
		if err := rows.Scan(&t.id, &t.name, &t.subscriptionID, &t.subscriptionSta, &t.otherMembers); err != nil {
			rows.Close()
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		owned = append(owned, t)
	}
	rows.Close()

	var blockers []accountDeleteBlocker
	for _, t := range owned {
		if t.otherMembers > 0 {
			blockers = append(blockers, accountDeleteBlocker{t.id, t.name, "This team still has other members. Remove them first; ownership transfer is not available yet."})
		}
		if t.subscriptionID.Valid && t.subscriptionID.String != "" && liveSubscriptionStatuses[strings.ToLower(t.subscriptionSta.String)] {
			blockers = append(blockers, accountDeleteBlocker{t.id, t.name, "This team has an active paid subscription. Cancel it from the billing portal first."})
		}
	}
	if len(blockers) > 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error":    "Your account can't be deleted yet. Resolve the items below and try again.",
			"blockers": blockers,
		})
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer func() { _ = tx.Rollback() }()

	fail := func(step string, err error) {
		log.Printf("[ACCOUNT] delete %s failed at %s: %v\n", user.ID, step, err)
		http.Error(w, "Failed to delete account; nothing was changed", http.StatusInternalServerError)
	}

	// 1. Owned (now guaranteed solo) teams, with their projects.
	for _, t := range owned {
		var projectIDs []string
		prow, err := tx.Query("SELECT id FROM projects WHERE team_id = ?", t.id)
		if err != nil {
			fail("list projects", err)
			return
		}
		for prow.Next() {
			var id string
			if err := prow.Scan(&id); err != nil {
				prow.Close()
				fail("scan projects", err)
				return
			}
			projectIDs = append(projectIDs, id)
		}
		prow.Close()
		if err := deleteProjectsTx(tx, projectIDs); err != nil {
			fail("delete projects", err)
			return
		}
		for _, stmt := range []string{
			"DELETE FROM invitations WHERE team_id = ?",
			"DELETE FROM team_members WHERE team_id = ?",
			"DELETE FROM teams WHERE id = ?",
		} {
			if _, err := tx.Exec(stmt, t.id); err != nil {
				fail("delete team", err)
				return
			}
		}
	}

	// 2. Hand anything the user created inside other people's teams to that
	// team's owner (these columns are NOT NULL, so they cannot just be cleared).
	owner := "(SELECT t.owner_id FROM projects p JOIN teams t ON t.id = p.team_id WHERE p.id = %s.project_id)"
	for _, stmt := range []string{
		"UPDATE projects SET created_by = (SELECT t.owner_id FROM teams t WHERE t.id = projects.team_id) WHERE created_by = ?",
		"UPDATE canvas_states SET updated_by = " + fmt.Sprintf(owner, "canvas_states") + " WHERE updated_by = ?",
		"UPDATE canvas_snapshots SET created_by = " + fmt.Sprintf(owner, "canvas_snapshots") + " WHERE created_by = ?",
		"UPDATE custom_nodes SET created_by = " + fmt.Sprintf(owner, "custom_nodes") + " WHERE created_by = ?",
		"UPDATE cloud_credentials SET created_by = " + fmt.Sprintf(owner, "cloud_credentials") + " WHERE created_by = ?",
		"UPDATE paired_agents SET created_by = " + fmt.Sprintf(owner, "paired_agents") + " WHERE created_by = ?",
	} {
		if _, err := tx.Exec(stmt, user.ID); err != nil {
			fail("reassign", err)
			return
		}
	}

	// 3. The user's own rows.
	for _, stmt := range []string{
		"DELETE FROM templates WHERE author_user_id = ?",
		"UPDATE activity_events SET actor_id = NULL WHERE actor_id = ?",
		"DELETE FROM project_members WHERE user_id = ?",
		"DELETE FROM project_join_requests WHERE user_id = ?",
		"DELETE FROM invitations WHERE invited_by = ?",
		"DELETE FROM team_members WHERE user_id = ?",
		"DELETE FROM oauth_identities WHERE user_id = ?",
		"DELETE FROM password_resets WHERE user_id = ?",
		"DELETE FROM user_avatars WHERE user_id = ?",
		"DELETE FROM users WHERE id = ?",
	} {
		if _, err := tx.Exec(stmt, user.ID); err != nil {
			fail("delete user rows", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		fail("commit", err)
		return
	}

	disconnectUserFromWorkspaces(user.ID)
	log.Printf("[ACCOUNT] user %s deleted their account\n", user.ID)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Your account has been deleted."})
}

// disconnectUserFromWorkspaces closes every live workspace-sync socket the
// user holds; their JWT is rejected by AuthMiddleware from now on, but an
// already-open WebSocket would otherwise keep relaying until it dropped.
func disconnectUserFromWorkspaces(userID string) {
	roomsMutex.Lock()
	snapshot := make([]*WorkspaceRoom, 0, len(rooms))
	for _, room := range rooms {
		snapshot = append(snapshot, room)
	}
	roomsMutex.Unlock()

	for _, room := range snapshot {
		room.RLock()
		for _, c := range room.clients {
			if c.userID == userID {
				_ = c.conn.Close()
			}
		}
		room.RUnlock()
	}
}
