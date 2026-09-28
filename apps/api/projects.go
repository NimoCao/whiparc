package main

import (
	"api/importer"
	"api/vault"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// Team payloads & models
type Team struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	OwnerID   string    `json:"owner_id"`
	CreatedAt time.Time `json:"created_at"`
}

type Project struct {
	ID          string    `json:"id"`
	TeamID      string    `json:"team_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Visibility  string    `json:"visibility"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	UserRole    string    `json:"user_role,omitempty"` // populated on details
}

type JoinRequest struct {
	ID          string     `json:"id"`
	ProjectID   string     `json:"project_id"`
	UserID      string     `json:"user_id"`
	UserName    string     `json:"user_name,omitempty"`
	UserEmail   string     `json:"user_email,omitempty"`
	Status      string     `json:"status"`
	Note        string     `json:"note"`
	RequestedAt time.Time  `json:"requested_at"`
	ReviewedAt  *time.Time `json:"reviewed_at,omitempty"`
}

// GET /api/teams
func handleGetTeams(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	rows, err := db.Query(`
		SELECT t.id, t.name, t.slug, t.owner_id, t.created_at 
		FROM teams t
		JOIN team_members tm ON tm.team_id = t.id
		WHERE tm.user_id = ?`, user.ID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	teams := []Team{}
	for rows.Next() {
		var t Team
		var createdAtStr string
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.OwnerID, &createdAtStr); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		t.CreatedAt, _ = time.Parse(time.RFC3339, createdAtStr)
		if t.CreatedAt.IsZero() {
			t.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAtStr)
		}
		teams = append(teams, t)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(teams)
}

// POST /api/teams
func handleCreateTeam(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	name := strings.TrimSpace(payload.Name)
	if name == "" {
		http.Error(w, "Team name is required", http.StatusBadRequest)
		return
	}

	teamID := fmt.Sprintf("team_%d", time.Now().UnixNano())
	slug := strings.ToLower(strings.ReplaceAll(name, " ", "-")) + "-" + fmt.Sprintf("%d", time.Now().Unix()%1000)

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Transaction start failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec("INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)", teamID, name, slug, user.ID)
	if err != nil {
		http.Error(w, "Failed to create team: "+err.Error(), http.StatusInternalServerError)
		return
	}

	memberID := fmt.Sprintf("tmem_%d", time.Now().UnixNano())
	_, err = tx.Exec("INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)", memberID, teamID, user.ID, "OWNER")
	if err != nil {
		http.Error(w, "Failed to join team: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Transaction commit failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"id":   teamID,
		"name": name,
		"slug": slug,
	})
}

// GET /api/projects
func handleGetProjects(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// NOTE: no GROUP BY here. project_members has UNIQUE(project_id, user_id)
	// and team_members has UNIQUE(team_id, user_id), so filtering both joins
	// to a single user_id already guarantees at most one matching row per
	// project — a GROUP BY p.id was never needed for de-duplication. It was
	// removed because Postgres (unlike SQLite) rejects selecting pm.role
	// un-aggregated when grouping only by p.id ("column pm.role must appear
	// in the GROUP BY clause or be used in an aggregate function"), which
	// made this entire query fail on Postgres — the real cause of projects
	// never showing up after the Supabase migration even though creation
	// succeeded.
	query := `
		SELECT p.id, p.team_id, p.name, p.description, p.visibility, p.created_by, p.created_at, p.updated_at,
		       COALESCE(pm.role, CASE WHEN p.created_by = ? THEN 'ADMIN' ELSE '' END) as user_role
		FROM projects p
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
		LEFT JOIN team_members tm ON tm.team_id = p.team_id AND tm.user_id = ?
		WHERE p.created_by = ?
		   OR pm.user_id IS NOT NULL
		   OR (p.visibility = 'TEAM' AND tm.user_id IS NOT NULL)
		   OR p.visibility = 'PUBLIC'`

	rows, err := db.Query(query, user.ID, user.ID, user.ID, user.ID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	projects := []Project{}
	for rows.Next() {
		var p Project
		var createdAtStr, updatedAtStr string
		err := rows.Scan(&p.ID, &p.TeamID, &p.Name, &p.Description, &p.Visibility, &p.CreatedBy, &createdAtStr, &updatedAtStr, &p.UserRole)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		p.CreatedAt, _ = time.Parse(time.RFC3339, createdAtStr)
		if p.CreatedAt.IsZero() {
			p.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAtStr)
		}
		p.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAtStr)
		if p.UpdatedAt.IsZero() {
			p.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAtStr)
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(projects)
}

// POST /api/projects
func handleCreateProject(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		TeamID      string `json:"team_id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Visibility  string `json:"visibility"` // PRIVATE, TEAM, PUBLIC
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	name := strings.TrimSpace(payload.Name)
	teamID := strings.TrimSpace(payload.TeamID)
	if name == "" {
		http.Error(w, "Project name is required", http.StatusBadRequest)
		return
	}

	visibility := "PRIVATE"
	if payload.Visibility == "TEAM" || payload.Visibility == "PUBLIC" {
		visibility = payload.Visibility
	}

	// Verify team exists and user is a member
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM team_members WHERE team_id = ? AND user_id = ?", teamID, user.ID).Scan(&count)
	if err != nil || count == 0 {
		http.Error(w, "Forbidden: You are not a member of the selected team", http.StatusForbidden)
		return
	}

	projectID := fmt.Sprintf("proj_%d", time.Now().UnixNano())

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec("INSERT INTO projects (id, team_id, name, description, visibility, created_by) VALUES (?, ?, ?, ?, ?, ?)",
		projectID, teamID, name, payload.Description, visibility, user.ID)
	if err != nil {
		http.Error(w, "Failed to create project: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Add creator as project Admin
	pmID := fmt.Sprintf("pmem_%d", time.Now().UnixNano())
	_, err = tx.Exec("INSERT INTO project_members (id, project_id, user_id, role, added_by) VALUES (?, ?, ?, ?, ?)",
		pmID, projectID, user.ID, "ADMIN", user.ID)
	if err != nil {
		http.Error(w, "Failed to assign project access: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Initialize blank canvas state
	_, err = tx.Exec("INSERT INTO canvas_states (project_id, nodes_json, edges_json, viewport_json, updated_by) VALUES (?, ?, ?, ?, ?)",
		projectID, "[]", "[]", `{"x":0,"y":0,"zoom":1}`, user.ID)
	if err != nil {
		http.Error(w, "Failed to initialize canvas state: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit transaction: "+err.Error(), http.StatusInternalServerError)
		return
	}

	insertActivityEvent(projectID, user.ID, "project.created", map[string]interface{}{"name": name})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"id":   projectID,
		"name": name,
	})
}

// GET /api/projects/{id}
func handleGetProjectByID(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	projectID := r.PathValue("id")

	var p Project
	var createdAtStr, updatedAtStr string
	err := db.QueryRow("SELECT id, team_id, name, description, visibility, created_by, created_at, updated_at FROM projects WHERE id = ?", projectID).Scan(
		&p.ID, &p.TeamID, &p.Name, &p.Description, &p.Visibility, &p.CreatedBy, &createdAtStr, &updatedAtStr)
	if err == sql.ErrNoRows {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	p.CreatedAt, _ = time.Parse(time.RFC3339, createdAtStr)
	if p.CreatedAt.IsZero() {
		p.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAtStr)
	}
	p.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAtStr)
	if p.UpdatedAt.IsZero() {
		p.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAtStr)
	}

	// Fetch current user role
	var role string
	err = db.QueryRow("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?", projectID, user.ID).Scan(&role)
	if err == nil {
		p.UserRole = role
	} else {
		// If project owner, role is ADMIN
		if p.CreatedBy == user.ID {
			p.UserRole = "ADMIN"
		} else if p.Visibility == "PUBLIC" {
			p.UserRole = "VIEWER"
		} else {
			// Check if team admin/owner
			var teamRole string
			err = db.QueryRow("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?", p.TeamID, user.ID).Scan(&teamRole)
			if err == nil && (teamRole == "OWNER" || teamRole == "ADMIN") {
				p.UserRole = "ADMIN"
			} else {
				// No role
				http.Error(w, "Forbidden", http.StatusForbidden)
				return
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(p)
}

// POST /api/projects/{id}/join-request
func handleCreateJoinRequest(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	projectID := r.PathValue("id")

	var payload struct {
		Note string `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)

	// Verify project exists
	var visibility string
	err := db.QueryRow("SELECT visibility FROM projects WHERE id = ?", projectID).Scan(&visibility)
	if err == sql.ErrNoRows {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	reqID := fmt.Sprintf("req_%d", time.Now().UnixNano())

	_, err = db.Exec("INSERT INTO project_join_requests (id, project_id, user_id, note) VALUES (?, ?, ?, ?)",
		reqID, projectID, user.ID, payload.Note)
	if err != nil {
		if isUniqueConstraintErr(err) {
			http.Error(w, "A request is already pending or approved for this project", http.StatusConflict)
		} else {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"id":     reqID,
		"status": "PENDING",
	})
}

// GET /api/projects/{id}/join-requests
func handleGetJoinRequests(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	rows, err := db.Query(`
		SELECT r.id, r.project_id, r.user_id, u.name, u.email, r.status, r.note, r.requested_at
		FROM project_join_requests r
		JOIN users u ON u.id = r.user_id
		WHERE r.project_id = ? AND r.status = 'PENDING'`, projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	requests := []JoinRequest{}
	for rows.Next() {
		var req JoinRequest
		var reqAtStr string
		err := rows.Scan(&req.ID, &req.ProjectID, &req.UserID, &req.UserName, &req.UserEmail, &req.Status, &req.Note, &reqAtStr)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		req.RequestedAt, _ = time.Parse(time.RFC3339, reqAtStr)
		if req.RequestedAt.IsZero() {
			req.RequestedAt, _ = time.Parse("2006-01-02 15:04:05", reqAtStr)
		}
		requests = append(requests, req)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(requests)
}

// POST /api/projects/{id}/join-requests/{reqId}/approve
func handleApproveJoinRequest(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	reqID := r.PathValue("reqId")

	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Fetch requester user ID
	var reqUserID string
	var status string
	err := db.QueryRow("SELECT user_id, status FROM project_join_requests WHERE id = ? AND project_id = ?", reqID, projectID).Scan(&reqUserID, &status)
	if err == sql.ErrNoRows {
		http.Error(w, "Request not found", http.StatusNotFound)
		return
	}

	if status != "PENDING" {
		http.Error(w, "Request already processed", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Update request status
	_, err = tx.Exec("UPDATE project_join_requests SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
		user.ID, reqID)
	if err != nil {
		http.Error(w, "Failed to update request: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Add user to project_members
	pmemID := fmt.Sprintf("pmem_%d", time.Now().UnixNano())
	insertMemberQuery := "INSERT OR IGNORE INTO project_members (id, project_id, user_id, role, added_by) VALUES (?, ?, ?, ?, ?)"
	if dbBackend == "postgres" {
		// Postgres has no "OR IGNORE" — project_members has a UNIQUE(project_id,
		// user_id) constraint, so ignoring a conflict on it is the equivalent.
		insertMemberQuery = "INSERT INTO project_members (id, project_id, user_id, role, added_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (project_id, user_id) DO NOTHING"
	}
	_, err = tx.Exec(insertMemberQuery, pmemID, projectID, reqUserID, "EDITOR", user.ID)
	if err != nil {
		http.Error(w, "Failed to add project membership: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit transaction: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var memberName string
	_ = db.QueryRow("SELECT name FROM users WHERE id = ?", reqUserID).Scan(&memberName)
	insertActivityEvent(projectID, user.ID, "member.added", map[string]interface{}{"member_name": memberName, "role": "EDITOR"})

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Request approved successfully"})
}

// POST /api/projects/{id}/join-requests/{reqId}/reject
func handleRejectJoinRequest(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	reqID := r.PathValue("reqId")

	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	_, err := db.Exec("UPDATE project_join_requests SET status = 'REJECTED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?",
		user.ID, reqID, projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Request rejected successfully"})
}

// GET /api/auth/me
func handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	email := user.Email
	name := user.Name
	plan := user.Plan
	emailVerified := user.EmailVerified
	var onboardingDismissedAt sql.NullTime

	err := db.QueryRow("SELECT email, name, plan, email_verified, onboarding_dismissed_at FROM users WHERE id = ?", user.ID).
		Scan(&email, &name, &plan, &emailVerified, &onboardingDismissedAt)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("[AUTH] Warning: failed to query live user for me endpoint: %v\n", err)
	}
	onboardingDismissed := onboardingDismissedAt.Valid

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                   user.ID,
		"email":                email,
		"name":                 name,
		"plan":                 plan,
		"email_verified":       emailVerified,
		"onboarding_dismissed": onboardingDismissed,
		"user": map[string]interface{}{
			"id":                   user.ID,
			"email":                email,
			"name":                 name,
			"plan":                 plan,
			"email_verified":       emailVerified,
			"onboarding_dismissed": onboardingDismissed,
		},
	})
}

// PATCH /api/auth/onboarding
// Persists dismissal of the dashboard's "Three steps to your first free
// deploy" checklist (product-memory 08.5 item A6) so it stays dismissed
// across reloads/devices instead of resetting on every page load. One-way:
// there's no "un-dismiss" — matches the checklist's own behavior of
// auto-hiding once a real fact (more than one project) makes it moot.
func handleDismissOnboarding(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if _, err := db.Exec("UPDATE users SET onboarding_dismissed_at = datetime('now') WHERE id = ?", user.ID); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"onboarding_dismissed": true})
}

// CanvasState models & handlers
type CanvasState struct {
	NodesJSON    string `json:"nodes_json"`
	EdgesJSON    string `json:"edges_json"`
	ViewportJSON string `json:"viewport_json"`
	Version      int    `json:"version"`
}

// GET /api/projects/{id}/canvas
func handleGetCanvasState(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	var nodes, edges, viewport string
	var version int
	err := db.QueryRow("SELECT nodes_json, edges_json, viewport_json, version FROM canvas_states WHERE project_id = ?", projectID).Scan(
		&nodes, &edges, &viewport, &version)
	if err == sql.ErrNoRows {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(CanvasState{
			NodesJSON:    "[]",
			EdgesJSON:    "[]",
			ViewportJSON: `{"x":0,"y":0,"zoom":1}`,
			Version:      1,
		})
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(CanvasState{
		NodesJSON:    nodes,
		EdgesJSON:    edges,
		ViewportJSON: viewport,
		Version:      version,
	})
}

// PUT /api/projects/{id}/canvas
func handleUpdateCanvasState(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		NodesJSON    string `json:"nodes_json"`
		EdgesJSON    string `json:"edges_json"`
		ViewportJSON string `json:"viewport_json"`
		Version      int    `json:"version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	var currentVersion int
	err := db.QueryRow("SELECT version FROM canvas_states WHERE project_id = ?", projectID).Scan(&currentVersion)
	if err == sql.ErrNoRows {
		// Initialize canvas state if not present
		currentVersion = 0
		_, _ = db.Exec("INSERT INTO canvas_states (project_id, nodes_json, edges_json, viewport_json, version, updated_by) VALUES (?, ?, ?, ?, ?, ?)",
			projectID, "[]", "[]", `{"x":0,"y":0,"zoom":1}`, 0, user.ID)
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if payload.Version != currentVersion {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"message":         "Version conflict: canvas state has been updated by another collaborator.",
			"current_version": currentVersion,
		})
		return
	}

	nextVersion := currentVersion + 1
	_, err = db.Exec("UPDATE canvas_states SET nodes_json = ?, edges_json = ?, viewport_json = ?, version = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?",
		payload.NodesJSON, payload.EdgesJSON, payload.ViewportJSON, nextVersion, user.ID, projectID)
	if err != nil {
		http.Error(w, "Failed to update canvas: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Canvas state saved successfully.",
		"version": nextVersion,
	})
}

// PATCH /api/projects/{id}
func handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	var payload struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Visibility  string `json:"visibility"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	payload.Visibility = strings.ToUpper(payload.Visibility)
	if payload.Visibility != "PRIVATE" && payload.Visibility != "TEAM" && payload.Visibility != "PUBLIC" {
		http.Error(w, "Invalid visibility", http.StatusBadRequest)
		return
	}

	_, err := db.Exec("UPDATE projects SET name = ?, description = ?, visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		payload.Name, payload.Description, payload.Visibility, projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Project updated successfully"})
}

// DELETE /api/projects/{id}
func handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	_, err := db.Exec("DELETE FROM projects WHERE id = ?", projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Project deleted successfully"})
}

type ProjectMemberInfo struct {
	UserID   string `json:"user_id"`
	UserName string `json:"user_name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	JoinedAt string `json:"joined_at"`
}

// GET /api/projects/{id}/members
func handleGetProjectMembers(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	var creatorID string
	err := db.QueryRow("SELECT created_by FROM projects WHERE id = ?", projectID).Scan(&creatorID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	rows, err := db.Query(`
		SELECT pm.user_id, u.name, u.email, pm.role, pm.joined_at 
		FROM project_members pm
		JOIN users u ON pm.user_id = u.id
		WHERE pm.project_id = ?
		UNION
		SELECT u.id, u.name, u.email, 'ADMIN' as role, p.created_at as joined_at
		FROM projects p
		JOIN users u ON p.created_by = u.id
		WHERE p.id = ?`, projectID, projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var members []ProjectMemberInfo
	seen := make(map[string]bool)

	for rows.Next() {
		var m ProjectMemberInfo
		if err := rows.Scan(&m.UserID, &m.UserName, &m.Email, &m.Role, &m.JoinedAt); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if !seen[m.UserID] {
			seen[m.UserID] = true
			if m.UserID == creatorID {
				m.Role = "ADMIN"
			}
			members = append(members, m)
		}
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(members)
}

// POST /api/projects/{id}/members
func handleAddProjectMember(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	payload.Role = strings.ToUpper(payload.Role)
	if payload.Role != "ADMIN" && payload.Role != "EDITOR" && payload.Role != "VIEWER" {
		http.Error(w, "Invalid role type", http.StatusBadRequest)
		return
	}

	var targetUserID string
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", strings.ToLower(payload.Email)).Scan(&targetUserID)
	if err == sql.ErrNoRows {
		http.Error(w, "User not found with this email", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	memberID := generateUUID()
	_, err = db.Exec("INSERT INTO project_members (id, project_id, user_id, role, added_by) VALUES (?, ?, ?, ?, ?)",
		memberID, projectID, targetUserID, payload.Role, user.ID)
	if err != nil {
		if isUniqueConstraintErr(err) {
			http.Error(w, "User is already a member of this project", http.StatusConflict)
			return
		}
		http.Error(w, "Failed to add member: "+err.Error(), http.StatusInternalServerError)
		return
	}

	insertActivityEvent(projectID, user.ID, "member.added", map[string]interface{}{"member_name": payload.Email, "role": payload.Role})

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Member added successfully"})
}

// PUT /api/projects/{id}/members/{userId}
func handleUpdateProjectMemberRole(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	targetUserID := r.PathValue("userId")

	var payload struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	payload.Role = strings.ToUpper(payload.Role)
	if payload.Role != "ADMIN" && payload.Role != "EDITOR" && payload.Role != "VIEWER" {
		http.Error(w, "Invalid role type", http.StatusBadRequest)
		return
	}

	var creatorID string
	err := db.QueryRow("SELECT created_by FROM projects WHERE id = ?", projectID).Scan(&creatorID)
	if err == nil && creatorID == targetUserID {
		http.Error(w, "Project owner's role cannot be updated", http.StatusBadRequest)
		return
	}

	_, err = db.Exec("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?",
		payload.Role, projectID, targetUserID)
	if err != nil {
		http.Error(w, "Failed to update member role: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Member role updated successfully"})
}

// DELETE /api/projects/{id}/members/{userId}
func handleRemoveProjectMember(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	targetUserID := r.PathValue("userId")

	var creatorID string
	err := db.QueryRow("SELECT created_by FROM projects WHERE id = ?", projectID).Scan(&creatorID)
	if err == nil && creatorID == targetUserID {
		http.Error(w, "Project owner cannot be removed from the project", http.StatusBadRequest)
		return
	}

	_, err = db.Exec("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", projectID, targetUserID)
	if err != nil {
		http.Error(w, "Failed to remove member: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Member removed successfully"})
}

// POST /api/projects/{id}/import
func handleImport(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		Files []struct {
			Name    string `json:"name"`
			Content string `json:"content"`
		} `json:"files"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	var allNodes []importer.CanvasNode
	var allEdges []importer.CanvasEdge

	for _, file := range payload.Files {
		content := file.Content
		name := strings.ToLower(file.Name)

		if strings.HasSuffix(name, ".tf") {
			nodes, edges, err := importer.ParseTerraform(content)
			if err != nil {
				http.Error(w, fmt.Sprintf("Error parsing Terraform in %s: %v", file.Name, err), http.StatusBadRequest)
				return
			}
			allNodes = append(allNodes, nodes...)
			allEdges = append(allEdges, edges...)
		} else if strings.HasSuffix(name, ".yml") || strings.HasSuffix(name, ".yaml") {
			isK8s := strings.Contains(content, "apiVersion:") && strings.Contains(content, "kind:")
			if isK8s {
				nodes, edges, err := importer.ParseKubernetes(content)
				if err != nil {
					http.Error(w, fmt.Sprintf("Error parsing Kubernetes in %s: %v", file.Name, err), http.StatusBadRequest)
					return
				}
				allNodes = append(allNodes, nodes...)
				allEdges = append(allEdges, edges...)
			} else {
				nodes, edges, err := importer.ParseAnsible(content)
				if err != nil {
					http.Error(w, fmt.Sprintf("Error parsing Ansible in %s: %v", file.Name, err), http.StatusBadRequest)
					return
				}
				allNodes = append(allNodes, nodes...)
				allEdges = append(allEdges, edges...)
			}
		}
	}

	// Fetch existing canvas state
	var existingNodes, existingEdges, existingViewport string
	var currentVersion int
	err := db.QueryRow("SELECT nodes_json, edges_json, viewport_json, version FROM canvas_states WHERE project_id = ?", projectID).Scan(
		&existingNodes, &existingEdges, &existingViewport, &currentVersion)
	if err == sql.ErrNoRows {
		existingNodes = "[]"
		existingEdges = "[]"
		existingViewport = `{"x":0,"y":0,"zoom":1}`
		currentVersion = 0
		_, err = db.Exec("INSERT INTO canvas_states (project_id, nodes_json, edges_json, viewport_json, version, updated_by) VALUES (?, ?, ?, ?, ?, ?)",
			projectID, "[]", "[]", existingViewport, 0, user.ID)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Merge existing and imported
	mergedNodesJSON, mergedEdgesJSON, err := importer.ArrangeNodesAndMerge(fmt.Sprintf(`{"nodes":%s,"edges":%s}`, existingNodes, existingEdges), allNodes, allEdges)
	if err != nil {
		http.Error(w, "Merge coordinates error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	nextVersion := currentVersion + 1
	_, err = db.Exec("UPDATE canvas_states SET nodes_json = ?, edges_json = ?, version = ?, updated_by = ?, updated_at = datetime('now') WHERE project_id = ?",
		mergedNodesJSON, mergedEdgesJSON, nextVersion, user.ID, projectID)
	if err != nil {
		http.Error(w, "Failed to save canvas state: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Broadcast WS sync event to all active workspaces room peers
	roomsMutex.Lock()
	room, exists := rooms[projectID]
	if exists {
		msgBytes, _ := json.Marshal(SyncMessage{
			Type:      "change",
			ProjectID: projectID,
			Payload:   json.RawMessage(fmt.Sprintf(`{"nodes":%s,"edges":%s}`, mergedNodesJSON, mergedEdgesJSON)),
		})
		room.Lock()
		for conn := range room.clients {
			_ = conn.WriteMessage(websocket.TextMessage, msgBytes)
		}
		room.Unlock()
	}
	roomsMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Files imported successfully",
		"nodes":   json.RawMessage(mergedNodesJSON),
		"edges":   json.RawMessage(mergedEdgesJSON),
		"version": nextVersion,
	})
}

type CredentialItem struct {
	ID             string `json:"id"`
	ProjectID      string `json:"project_id"`
	Provider       string `json:"provider"`
	Name           string `json:"name"`
	KeyFingerprint string `json:"key_fingerprint"`
	CreatedAt      string `json:"created_at"`
}

// GET /api/projects/{id}/credentials
func handleGetProjectCredentials(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	rows, err := db.Query("SELECT id, project_id, provider, name, key_fingerprint, created_at FROM cloud_credentials WHERE project_id = ? ORDER BY created_at DESC", projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var items []CredentialItem = []CredentialItem{}
	for rows.Next() {
		var item CredentialItem
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Provider, &item.Name, &item.KeyFingerprint, &item.CreatedAt); err == nil {
			items = append(items, item)
		}
	}

	if err = rows.Err(); err != nil {
		http.Error(w, "Database error during row iteration: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

// POST /api/projects/{id}/credentials
func handleCreateProjectCredential(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		Name     string `json:"name"`
		Provider string `json:"provider"`
		RawData  string `json:"raw_data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	if payload.Name == "" || payload.Provider == "" || payload.RawData == "" {
		http.Error(w, "Missing name, provider, or raw_data in payload", http.StatusBadRequest)
		return
	}

	if payload.Provider != "AWS" && payload.Provider != "GCP" && payload.Provider != "SSH" && payload.Provider != "GITHUB" {
		http.Error(w, "Invalid provider: must be AWS, GCP, SSH, or GITHUB", http.StatusBadRequest)
		return
	}

	cipherText, nonce, authTag, err := vault.Encrypt([]byte(payload.RawData))
	if err != nil {
		http.Error(w, "Vault encryption failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	fingerprint := vault.Fingerprint(payload.Provider, []byte(payload.RawData))
	credID := generateUUID()

	_, err = db.Exec("INSERT INTO cloud_credentials (id, project_id, provider, name, encrypted_data, nonce, auth_tag, key_fingerprint, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		credID, projectID, payload.Provider, payload.Name, cipherText, nonce, authTag, fingerprint, user.ID)
	if err != nil {
		http.Error(w, "Failed to save credential: "+err.Error(), http.StatusInternalServerError)
		return
	}

	insertActivityEvent(projectID, user.ID, "credential.created", map[string]interface{}{"name": payload.Name, "provider": payload.Provider})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":              credID,
		"message":         "Credential saved securely",
		"key_fingerprint": fingerprint,
	})
}

// DELETE /api/projects/{id}/credentials/{credId}
func handleDeleteProjectCredential(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	credID := r.PathValue("credId")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Looked up before the DELETE — the blind delete below leaves nothing to
	// read these from afterward, and the activity event is more useful with
	// a real name/provider than just the (soon deleted) credential id.
	var credName, credProvider string
	_ = db.QueryRow("SELECT name, provider FROM cloud_credentials WHERE id = ? AND project_id = ?", credID, projectID).Scan(&credName, &credProvider)

	_, err := db.Exec("DELETE FROM cloud_credentials WHERE id = ? AND project_id = ?", credID, projectID)
	if err != nil {
		http.Error(w, "Failed to delete credential: "+err.Error(), http.StatusInternalServerError)
		return
	}

	insertActivityEvent(projectID, user.ID, "credential.revoked", map[string]interface{}{"name": credName, "provider": credProvider})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Credential deleted successfully"})
}
