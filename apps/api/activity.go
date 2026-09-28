package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"
)

// insertActivityEvent records a dashboard-visible activity event
// (product-memory 08.5 item A5). Fire-and-forget by design, matching this
// codebase's established style for non-critical side effects (see
// apps/api/pairing.go's best-effort RegisterToken call) — a failure here
// must never fail the operation that triggered it, so errors are logged,
// not returned.
func insertActivityEvent(projectID, actorID, kind string, payload map[string]interface{}) {
	var teamID sql.NullString
	if projectID != "" {
		_ = db.QueryRow("SELECT team_id FROM projects WHERE id = ?", projectID).Scan(&teamID)
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		payloadJSON = []byte("{}")
	}
	id := fmt.Sprintf("evt_%d", time.Now().UnixNano())
	if _, err := db.Exec(
		"INSERT INTO activity_events (id, team_id, project_id, actor_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
		id, teamID, projectID, actorID, kind, string(payloadJSON),
	); err != nil {
		log.Printf("[ACTIVITY] Failed to record %s event for project %s: %v\n", kind, projectID, err)
	}
}

// ActivityEvent is what GET /api/activity returns per row. ProjectID/
// ProjectName/ActorID/ActorName are pointers so a project or user deleted
// after the event was recorded still renders the event (as "—" client-side)
// instead of disappearing or erroring — the LEFT JOINs below are what make
// that possible.
type ActivityEvent struct {
	ID          string          `json:"id"`
	ProjectID   *string         `json:"projectId"`
	ProjectName *string         `json:"projectName"`
	ActorID     *string         `json:"actorId"`
	ActorName   *string         `json:"actorName"`
	Kind        string          `json:"kind"`
	Payload     json.RawMessage `json:"payload"`
	CreatedAt   time.Time       `json:"createdAt"`
}

// GET /api/activity?limit=
// Scoped to exactly the same project-access predicate as handleGetProjects
// (created_by OR project_members OR TEAM-visibility-via-team_members OR
// PUBLIC) — a user sees activity for exactly the projects they can already
// see on /projects, with no separate permission model to keep in sync.
func handleGetActivity(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	rows, err := db.Query(`
		SELECT ae.id, ae.project_id, p.name, ae.actor_id, u.name, ae.kind, ae.payload_json, ae.created_at
		FROM activity_events ae
		LEFT JOIN projects p ON p.id = ae.project_id
		LEFT JOIN users u ON u.id = ae.actor_id
		WHERE ae.project_id IN (
			SELECT pr.id FROM projects pr
			LEFT JOIN project_members pm ON pm.project_id = pr.id AND pm.user_id = ?
			LEFT JOIN team_members tm ON tm.team_id = pr.team_id AND tm.user_id = ?
			WHERE pr.created_by = ?
			   OR pm.user_id IS NOT NULL
			   OR (pr.visibility = 'TEAM' AND tm.user_id IS NOT NULL)
			   OR pr.visibility = 'PUBLIC'
		)
		ORDER BY ae.created_at DESC
		LIMIT ?`, user.ID, user.ID, user.ID, limit)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	events := []ActivityEvent{}
	for rows.Next() {
		var e ActivityEvent
		var projectID, projectName, actorID, actorName sql.NullString
		var payloadStr string
		if err := rows.Scan(&e.ID, &projectID, &projectName, &actorID, &actorName, &e.Kind, &payloadStr, &e.CreatedAt); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if projectID.Valid {
			e.ProjectID = &projectID.String
		}
		if projectName.Valid {
			e.ProjectName = &projectName.String
		}
		if actorID.Valid {
			e.ActorID = &actorID.String
		}
		if actorName.Valid {
			e.ActorName = &actorName.String
		}
		if payloadStr == "" {
			payloadStr = "{}"
		}
		e.Payload = json.RawMessage(payloadStr)
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(events)
}
