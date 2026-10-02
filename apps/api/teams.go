package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// This file is product-memory 08.5 item E: real team-roster (E2), invite
// (E1), and team-scoped aggregate (E3) endpoints. Per the decision recorded
// alongside 08.5, "Team" here means the literal team_members.role
// (OWNER/ADMIN/MEMBER) — a coarser, separate enum from project_members.role
// (ADMIN/EDITOR/VIEWER) — not the synthesized per-project-role aggregate
// TeamPageV2.tsx computed before this shipped. checkProjectAccess's existing
// team OWNER/ADMIN -> project ADMIN bridge (auth.go) is the only place the
// two models interact; this file doesn't change that.

type TeamMemberInfo struct {
	UserID   string `json:"user_id"`
	UserName string `json:"user_name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	JoinedAt string `json:"joined_at"`
}

// GET /api/teams/{id}/members
func handleGetTeamMembers(w http.ResponseWriter, r *http.Request) {
	teamID := r.PathValue("id")

	rows, err := db.Query(`
		SELECT tm.user_id, u.name, u.email, tm.role, tm.joined_at
		FROM team_members tm
		JOIN users u ON tm.user_id = u.id
		WHERE tm.team_id = ?
		ORDER BY tm.joined_at ASC`, teamID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	members := []TeamMemberInfo{}
	for rows.Next() {
		var m TeamMemberInfo
		if err := rows.Scan(&m.UserID, &m.UserName, &m.Email, &m.Role, &m.JoinedAt); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(members)
}

// PATCH /api/teams/{id}/members/{userId}
func handleUpdateTeamMemberRole(w http.ResponseWriter, r *http.Request) {
	teamID := r.PathValue("id")
	targetUserID := r.PathValue("userId")

	var payload struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	payload.Role = strings.ToUpper(payload.Role)
	// OWNER is deliberately not settable here — ownership transfer isn't
	// part of this item's scope, and teams.owner_id (a separate denormalized
	// column) would need to move in lockstep with any OWNER reassignment.
	if payload.Role != "ADMIN" && payload.Role != "MEMBER" {
		http.Error(w, "Invalid role: must be ADMIN or MEMBER", http.StatusBadRequest)
		return
	}

	var ownerID string
	if err := db.QueryRow("SELECT owner_id FROM teams WHERE id = ?", teamID).Scan(&ownerID); err != nil {
		http.Error(w, "Team not found", http.StatusNotFound)
		return
	}
	if ownerID == targetUserID {
		http.Error(w, "The team owner's role cannot be changed", http.StatusBadRequest)
		return
	}

	res, err := db.Exec("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?", payload.Role, teamID, targetUserID)
	if err != nil {
		http.Error(w, "Failed to update member role: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "Team member not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Member role updated successfully"})
}

// DELETE /api/teams/{id}/members/{userId}
func handleRemoveTeamMember(w http.ResponseWriter, r *http.Request) {
	teamID := r.PathValue("id")
	targetUserID := r.PathValue("userId")

	var ownerID string
	if err := db.QueryRow("SELECT owner_id FROM teams WHERE id = ?", teamID).Scan(&ownerID); err != nil {
		http.Error(w, "Team not found", http.StatusNotFound)
		return
	}
	if ownerID == targetUserID {
		http.Error(w, "The team owner cannot be removed from the team", http.StatusBadRequest)
		return
	}

	// Deliberately does not cascade-remove the user's project_members rows
	// on any project owned by this team — leaving the team doesn't revoke
	// access someone was individually granted on a specific project, same
	// as how team membership never implied project membership going in
	// (only team OWNER/ADMIN gets an automatic bridge, via checkProjectAccess).
	res, err := db.Exec("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", teamID, targetUserID)
	if err != nil {
		http.Error(w, "Failed to remove member: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "Team member not found", http.StatusNotFound)
		return
	}
	go syncTeamBillingSeats(teamID)

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Member removed successfully"})
}

// teamProjectIDsVisibleTo returns the subset of a team's projects the given
// user actually has at least VIEWER access to, via the same
// checkProjectAccess predicate every other project-scoped endpoint enforces.
// Plain team MEMBERs don't get the OWNER/ADMIN -> project ADMIN bridge
// (see auth.go), so without this filter a team-wide aggregate endpoint
// would expose a PRIVATE project's credentials/runs to a team MEMBER who
// isn't a member of that specific project — a wider hole than
// GET /api/projects/{id}/credentials already guards against today.
func teamProjectIDsVisibleTo(userID, teamID string) (ids []string, names map[string]string, err error) {
	rows, err := db.Query("SELECT id, name FROM projects WHERE team_id = ?", teamID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	names = make(map[string]string)
	for rows.Next() {
		var pid, pname string
		if err := rows.Scan(&pid, &pname); err != nil {
			return nil, nil, err
		}
		if allowed, _, _ := checkProjectAccess(userID, pid, "VIEWER"); allowed {
			ids = append(ids, pid)
			names[pid] = pname
		}
	}
	return ids, names, rows.Err()
}

func placeholdersFor(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

type TeamCredentialItem struct {
	CredentialItem
	ProjectName string `json:"project_name"`
}

// GET /api/teams/{id}/credentials — product-memory 08.5 item E3. Replaces
// the client-side per-project fan-out CredentialsPageV2.tsx used to do
// (GET /api/projects then N x GET /api/projects/{id}/credentials) with one
// call per team instead of one per project.
func handleGetTeamCredentials(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	teamID := r.PathValue("id")

	projectIDs, names, err := teamProjectIDsVisibleTo(user.ID, teamID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	items := []TeamCredentialItem{}
	if len(projectIDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(items)
		return
	}

	args := make([]interface{}, len(projectIDs))
	for i, id := range projectIDs {
		args[i] = id
	}
	query := "SELECT " + credentialItemColumns + " FROM cloud_credentials WHERE project_id IN (" + placeholdersFor(len(projectIDs)) + ") ORDER BY created_at DESC"
	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		item, err := scanCredentialItem(rows)
		if err != nil {
			continue
		}
		items = append(items, TeamCredentialItem{CredentialItem: item, ProjectName: names[item.ProjectID]})
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

// GET /api/teams/{id}/runs?limit= — product-memory 08.5 item E3.
func handleGetTeamRuns(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	teamID := r.PathValue("id")

	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 200 {
		limit = 200
	}

	projectIDs, _, err := teamProjectIDsVisibleTo(user.ID, teamID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	runs := []PipelineRun{}
	if len(projectIDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(runs)
		return
	}

	args := make([]interface{}, 0, len(projectIDs)+1)
	for _, id := range projectIDs {
		args = append(args, id)
	}
	args = append(args, limit)
	query := runsWithTriggeredByQuery + " WHERE pr.project_id IN (" + placeholdersFor(len(projectIDs)) + ") ORDER BY pr.created_at DESC LIMIT ?"
	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		run, err := scanPipelineRun(rows)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(runs)
}

// --- Invitations (product-memory 08.5 item E1) ---
// Uses the `invitations` table that already existed in the bootstrap schema
// but had never been read or written by any handler before this.

type InvitationInfo struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	Status    string `json:"status"`
	InvitedBy string `json:"invited_by_name"`
	ExpiresAt string `json:"expires_at"`
	CreatedAt string `json:"created_at"`
}

// POST /api/teams/{id}/invites
func handleCreateTeamInvite(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	teamID := r.PathValue("id")

	var payload struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}
	email := strings.ToLower(strings.TrimSpace(payload.Email))
	role := strings.ToUpper(payload.Role)
	if email == "" {
		http.Error(w, "Email is required", http.StatusBadRequest)
		return
	}
	if role != "ADMIN" && role != "MEMBER" {
		http.Error(w, "Invalid role: must be ADMIN or MEMBER", http.StatusBadRequest)
		return
	}

	var teamName string
	if err := db.QueryRow("SELECT name FROM teams WHERE id = ?", teamID).Scan(&teamName); err != nil {
		http.Error(w, "Team not found", http.StatusNotFound)
		return
	}

	// Already a member? No point inviting them again.
	var existingMemberID string
	err := db.QueryRow(`
		SELECT tm.user_id FROM team_members tm
		JOIN users u ON tm.user_id = u.id
		WHERE tm.team_id = ? AND u.email = ?`, teamID, email).Scan(&existingMemberID)
	if err == nil {
		http.Error(w, "This person is already a member of the team", http.StatusConflict)
		return
	}

	var existingInviteID string
	err = db.QueryRow("SELECT id FROM invitations WHERE team_id = ? AND email = ? AND status = 'PENDING'", teamID, email).Scan(&existingInviteID)
	if err == nil {
		http.Error(w, "An invite is already pending for this email — revoke it first to send a new one", http.StatusConflict)
		return
	}

	if msg := memberLimitMessage(teamID, true); msg != "" {
		writePlanLimit(w, msg)
		return
	}

	inviteID := generateUUID()
	token := generateRandomHex(32)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = db.Exec(`
		INSERT INTO invitations (id, team_id, project_id, email, role, token, status, invited_by, expires_at)
		VALUES (?, ?, NULL, ?, ?, ?, 'PENDING', ?, ?)`,
		inviteID, teamID, email, role, token, user.ID, expiresAt)
	if err != nil {
		http.Error(w, "Failed to create invite: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// teamName/user.Name are validated here, at the call site — see
	// validateEmailContentName in mailer.go for why a guard-and-reject check
	// is used here instead of sanitizeName's strip-and-continue.
	acceptLink := fmt.Sprintf("%s/invites/accept?token=%s", oauthFrontendBase(), token)
	go func() {
		if err := emailSender.SendInviteEmail(email, validateEmailContentName(teamName), validateEmailContentName(user.Name), acceptLink); err != nil {
			log.Printf("[EMAIL] Failed to send invite email to %s: %v\n", email, err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"id": inviteID, "message": "Invite sent"})
}

// GET /api/teams/{id}/invites
func handleListTeamInvites(w http.ResponseWriter, r *http.Request) {
	teamID := r.PathValue("id")

	rows, err := db.Query(`
		SELECT i.id, i.email, i.role, i.status, u.name, i.expires_at, i.created_at
		FROM invitations i
		JOIN users u ON i.invited_by = u.id
		WHERE i.team_id = ? AND i.status = 'PENDING'
		ORDER BY i.created_at DESC`, teamID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	invites := []InvitationInfo{}
	for rows.Next() {
		var inv InvitationInfo
		if err := rows.Scan(&inv.ID, &inv.Email, &inv.Role, &inv.Status, &inv.InvitedBy, &inv.ExpiresAt, &inv.CreatedAt); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		invites = append(invites, inv)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(invites)
}

// DELETE /api/teams/{id}/invites/{inviteId}
func handleRevokeTeamInvite(w http.ResponseWriter, r *http.Request) {
	teamID := r.PathValue("id")
	inviteID := r.PathValue("inviteId")

	// invitations.status has no CANCELLED/REVOKED value in its CHECK
	// constraint (only PENDING/ACCEPTED/EXPIRED) — hard-deleting a
	// still-pending invite mirrors how credential revoke works elsewhere
	// in this codebase (handleDeleteProjectCredential): a permanent,
	// immediate removal rather than a soft-delete flag.
	res, err := db.Exec("DELETE FROM invitations WHERE id = ? AND team_id = ? AND status = 'PENDING'", inviteID, teamID)
	if err != nil {
		http.Error(w, "Failed to revoke invite: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "Pending invite not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Invite revoked"})
}

// GET /api/invites/{token}/preview — public (the recipient may not have an
// account yet, so there's no session to authenticate). Possession of the
// unguessable token (sent only to the invited address) is the credential;
// the response lets the accept page say *what* is being offered and prefill
// the invited email into sign-in/sign-up, instead of a bare "sign in".
func handleInvitePreview(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")

	var teamName, inviterName, email, role, status string
	var expiresAt time.Time
	err := db.QueryRow(`
		SELECT t.name, u.name, i.email, i.role, i.status, i.expires_at
		FROM invitations i
		JOIN teams t ON i.team_id = t.id
		JOIN users u ON i.invited_by = u.id
		WHERE i.token = ?`, token).Scan(&teamName, &inviterName, &email, &role, &status, &expiresAt)
	if err == sql.ErrNoRows {
		http.Error(w, "Invite not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"team_name":       teamName,
		"invited_by_name": inviterName,
		"email":           email,
		"role":            role,
		"status":          status,
		"expired":         status == "PENDING" && time.Now().After(expiresAt),
	})
}

// POST /api/invites/{token}/accept — the only invite route not gated by
// RequireTeamRole, since the whole point is the caller isn't a team member
// yet. Still requires AuthMiddleware: the invite's target identity is
// checked against the signed-in user's own email, not a bare token-holder
// assumption.
//
// Idempotent for the same user: a repeat call after a successful accept
// (double-fired effect, a refresh, a second click) returns success instead
// of "no longer valid" — the first call already did the work.
//
// Accepting also marks the account's email verified when it was still
// unverified: the invite token only ever travels to the invited address, so
// redeeming it from an account on that exact address proves mailbox control
// just as the signup verification link would. Without this, someone who
// signs up *from* an invite link has to chase a second email to finish.
func handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	token := r.PathValue("token")

	var inviteID, teamID, email, role, status string
	var expiresAt time.Time
	err := db.QueryRow("SELECT id, team_id, email, role, status, expires_at FROM invitations WHERE token = ?", token).
		Scan(&inviteID, &teamID, &email, &role, &status, &expiresAt)
	if err == sql.ErrNoRows {
		http.Error(w, "Invite not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Read the live row, not the JWT claims — the email in a token can be
	// stale after an email change, and email_verified after verification.
	var userEmail, userName string
	var emailVerified bool
	if err := db.QueryRow("SELECT email, name, email_verified FROM users WHERE id = ?", user.ID).Scan(&userEmail, &userName, &emailVerified); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !strings.EqualFold(email, userEmail) {
		http.Error(w, "This invite was sent to a different email address", http.StatusForbidden)
		return
	}

	var alreadyMember string
	memberErr := db.QueryRow("SELECT user_id FROM team_members WHERE team_id = ? AND user_id = ?", teamID, user.ID).Scan(&alreadyMember)
	if status == "ACCEPTED" && memberErr == nil {
		writeInviteAccepted(w, teamID, user.ID, userEmail, userName, emailVerified, "You're already on this team")
		return
	}
	if status != "PENDING" {
		http.Error(w, "This invite is no longer valid", http.StatusGone)
		return
	}
	if time.Now().After(expiresAt) {
		_, _ = db.Exec("UPDATE invitations SET status = 'EXPIRED' WHERE id = ?", inviteID)
		http.Error(w, "This invite has expired", http.StatusGone)
		return
	}

	// The invite itself was counted as a reserved seat when it was created,
	// so only *members* are counted here — this catches the team having been
	// downgraded or filled by other means between invite and accept.
	if memberErr != nil {
		if msg := memberLimitMessage(teamID, false); msg != "" {
			writePlanLimit(w, msg)
			return
		}
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Transaction start failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if memberErr != nil {
		memberID := generateUUID()
		if _, err := tx.Exec("INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)", memberID, teamID, user.ID, role); err != nil {
			http.Error(w, "Failed to join team: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if _, err := tx.Exec("UPDATE invitations SET status = 'ACCEPTED' WHERE id = ?", inviteID); err != nil {
		http.Error(w, "Failed to finalize invite: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !emailVerified {
		if _, err := tx.Exec("UPDATE users SET email_verified = TRUE, verification_token = NULL, verification_expires_at = NULL WHERE id = ?", user.ID); err != nil {
			http.Error(w, "Failed to verify email: "+err.Error(), http.StatusInternalServerError)
			return
		}
		emailVerified = true
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Transaction commit failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	go syncTeamBillingSeats(teamID)

	writeInviteAccepted(w, teamID, user.ID, userEmail, userName, emailVerified, "Invite accepted")
}

// writeInviteAccepted replies with a freshly signed token alongside the
// team id: accepting can flip email_verified, which rides in the JWT, so the
// client swaps its session instead of carrying a stale unverified claim.
func writeInviteAccepted(w http.ResponseWriter, teamID, userID, email, name string, emailVerified bool, message string) {
	token, err := GenerateToken(userID, email, name, emailVerified)
	if err != nil {
		http.Error(w, "Failed to sign token: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"team_id": teamID,
		"message": message,
		"token":   token,
		"user": map[string]interface{}{
			"id":             userID,
			"email":          email,
			"name":           name,
			"email_verified": emailVerified,
		},
	})
}
