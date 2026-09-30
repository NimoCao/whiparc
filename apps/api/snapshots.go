package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// insertCanvasSnapshot records a point-in-time copy of a project's canvas
// right after a successful deploy or destroy run (product-memory 08.5 item
// G4). canvas_states itself is overwritten on every autosave and isn't a
// usable history by itself — a snapshot per successful run gives a
// meaningful, infrequent checkpoint to revert to instead. canvasStr is the
// same already-assembled `{"nodes":...,"edges":...}` JSON handleDeploy/
// handleDestroy pass to the runner, so this never re-reads canvas_states
// (which may have changed again by the time the run finishes).
//
// Fire-and-forget, matching insertActivityEvent's established style for
// this kind of non-critical side effect — a failure here must never fail
// the run that triggered it.
func insertCanvasSnapshot(projectID, userID, canvasStr, commitMessage string) {
	var parsed struct {
		Nodes json.RawMessage `json:"nodes"`
		Edges json.RawMessage `json:"edges"`
	}
	if err := json.Unmarshal([]byte(canvasStr), &parsed); err != nil {
		log.Printf("[SNAPSHOT] Failed to parse canvas for project %s: %v\n", projectID, err)
		return
	}
	nodesJSON := string(parsed.Nodes)
	if nodesJSON == "" {
		nodesJSON = "[]"
	}
	edgesJSON := string(parsed.Edges)
	if edgesJSON == "" {
		edgesJSON = "[]"
	}

	// A per-project sequence of "deploy checkpoints", deliberately not tied
	// to canvas_states.version (which bumps on every autosave and would make
	// this column noisy/meaningless as a snapshot ordinal).
	var nextVersion int
	if err := db.QueryRow("SELECT COALESCE(MAX(version), 0) + 1 FROM canvas_snapshots WHERE project_id = ?", projectID).Scan(&nextVersion); err != nil {
		log.Printf("[SNAPSHOT] Failed to compute next version for project %s: %v\n", projectID, err)
		return
	}

	id := fmt.Sprintf("snap_%d", time.Now().UnixNano())
	if _, err := db.Exec(
		"INSERT INTO canvas_snapshots (id, project_id, version, commit_message, nodes_json, edges_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
		id, projectID, nextVersion, commitMessage, nodesJSON, edgesJSON, userID,
	); err != nil {
		log.Printf("[SNAPSHOT] Failed to insert snapshot for project %s: %v\n", projectID, err)
	}
}

// SnapshotInfo is what GET /api/projects/{id}/snapshots returns per row —
// deliberately without nodes_json/edges_json, matching the runs-list
// pattern of keeping the list view light and only fetching the heavy
// payload (here, inline within the revert call) when actually needed.
type SnapshotInfo struct {
	ID            string    `json:"id"`
	Version       int       `json:"version"`
	CommitMessage string    `json:"commitMessage"`
	CreatedByName string    `json:"createdByName"`
	CreatedAt     time.Time `json:"createdAt"`
}

// GET /api/projects/{id}/snapshots
func handleGetSnapshots(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	rows, err := db.Query(`
		SELECT cs.id, cs.version, COALESCE(cs.commit_message, ''), COALESCE(u.name, 'Unknown'), cs.created_at
		FROM canvas_snapshots cs
		LEFT JOIN users u ON u.id = cs.created_by
		WHERE cs.project_id = ?
		ORDER BY cs.version DESC`, projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	snapshots := []SnapshotInfo{}
	for rows.Next() {
		var s SnapshotInfo
		if err := rows.Scan(&s.ID, &s.Version, &s.CommitMessage, &s.CreatedByName, &s.CreatedAt); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		snapshots = append(snapshots, s)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snapshots)
}

// POST /api/projects/{id}/snapshots/{snapshotId}/revert — restores the
// *canvas editor state* to this snapshot's nodes/edges. Deliberately does
// NOT trigger a deploy itself: silently re-running infrastructure changes
// as a side effect of a "revert" click would be surprising and potentially
// destructive. The user reverts, reviews the canvas, then deploys
// explicitly if that's what they want — same two-step shape as every other
// deploy path in this app.
func handleRevertSnapshot(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	snapshotID := r.PathValue("snapshotId")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var nodesJSON, edgesJSON string
	var version int
	err := db.QueryRow(
		"SELECT nodes_json, edges_json, version FROM canvas_snapshots WHERE id = ? AND project_id = ?",
		snapshotID, projectID,
	).Scan(&nodesJSON, &edgesJSON, &version)
	if err != nil {
		http.Error(w, "Snapshot not found", http.StatusNotFound)
		return
	}

	var currentVersion int
	err = db.QueryRow("SELECT version FROM canvas_states WHERE project_id = ?", projectID).Scan(&currentVersion)
	if err == sql.ErrNoRows {
		if _, err := db.Exec(
			"INSERT INTO canvas_states (project_id, nodes_json, edges_json, viewport_json, version, updated_by) VALUES (?, ?, ?, '{}', 1, ?)",
			projectID, nodesJSON, edgesJSON, user.ID,
		); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	} else {
		if _, err := db.Exec(
			"UPDATE canvas_states SET nodes_json = ?, edges_json = ?, version = ?, updated_by = ?, updated_at = datetime('now') WHERE project_id = ?",
			nodesJSON, edgesJSON, currentVersion+1, user.ID, projectID,
		); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	insertActivityEvent(projectID, user.ID, "snapshot.reverted", map[string]interface{}{"version": version})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"nodes": json.RawMessage(nodesJSON),
		"edges": json.RawMessage(edgesJSON),
	})
}
