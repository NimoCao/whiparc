package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// Template contributions: the suggest-changes workflow behind the catalog's
// "Contribute" button (product-memory 10.1 Phase 7). A contributor edits their
// own copy of a template (a normal project, e.g. one made with "Get Started"),
// then submits a snapshot of that project's canvas against the template. The
// template's author reviews it and either accepts, which replaces the
// template's canvas with the proposal, or rejects it. Nothing changes on the
// template until it is accepted, and a template is never edited in place by
// anyone but its reviewer.

const (
	officialTemplateAuthor = "whiparc_official"
	maxContributionNote    = 1000
	maxReviewNote          = 1000
)

// templateContribution is the wire shape for both the reviewer list (with the
// canvas payload so the proposal can be previewed) and "my contributions"
// (without it, plus the template's title).
type templateContribution struct {
	ID              string  `json:"id"`
	TemplateID      string  `json:"template_id"`
	TemplateTitle   string  `json:"template_title,omitempty"`
	ContributorID   string  `json:"contributor_user_id"`
	ContributorName string  `json:"contributor_name,omitempty"`
	SourceProjectID *string `json:"source_project_id,omitempty"`
	Note            string  `json:"note"`
	Status          string  `json:"status"`
	ReviewNote      string  `json:"review_note,omitempty"`
	CreatedAt       string  `json:"created_at"`
	ReviewedAt      *string `json:"reviewed_at,omitempty"`

	NodesJSON    string `json:"nodes_json,omitempty"`
	EdgesJSON    string `json:"edges_json,omitempty"`
	ViewportJSON string `json:"viewport_json,omitempty"`
}

// isTemplateCurator reports whether the caller is listed in the comma-separated TEMPLATE_CURATOR_EMAILS list:
// the accounts allowed to review contributions to official (Whiparc-authored)
// templates, which have no real author to ask. Unset means nobody can, so
// official templates simply collect no accepted changes on an install that
// has not named a curator.
func isTemplateCurator(claims *TokenClaims) bool {
	if claims == nil || !claims.EmailVerified || claims.Email == "" {
		return false
	}
	for _, e := range strings.Split(os.Getenv("TEMPLATE_CURATOR_EMAILS"), ",") {
		if strings.EqualFold(strings.TrimSpace(e), claims.Email) {
			return true
		}
	}
	return false
}

// canReviewTemplate: a user's own template, or, for an official one, a curator.
func canReviewTemplate(claims *TokenClaims, templateAuthorID string) bool {
	if templateAuthorID == officialTemplateAuthor {
		return isTemplateCurator(claims)
	}
	return templateAuthorID == claims.ID
}

// POST /api/templates/{id}/contributions — auth required. Body:
// {"project_id": "...", "note": "..."}. Snapshots the project's current canvas
// as a PENDING contribution. The caller must be an ADMIN of that project (the
// same bar as publishing a project's canvas as a template).
func handleCreateTemplateContribution(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	templateID := r.PathValue("id")

	var payload struct {
		ProjectID string `json:"project_id"`
		Note      string `json:"note"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	note := strings.TrimSpace(payload.Note)
	if note == "" {
		http.Error(w, "Describe what you changed so the author can review it", http.StatusBadRequest)
		return
	}
	if len([]rune(note)) > maxContributionNote {
		http.Error(w, fmt.Sprintf("Note must be %d characters or fewer", maxContributionNote), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(payload.ProjectID) == "" {
		http.Error(w, "project_id is required", http.StatusBadRequest)
		return
	}

	var authorID, tNodes, tEdges string
	err := db.QueryRow("SELECT author_user_id, nodes_json, edges_json FROM templates WHERE id = ? AND status = 'PUBLISHED'", templateID).
		Scan(&authorID, &tNodes, &tEdges)
	if err == sql.ErrNoRows {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if authorID == user.ID {
		http.Error(w, "You published this template, edit it directly instead of contributing to it", http.StatusBadRequest)
		return
	}

	if allowed, status, msg := checkProjectAccess(user.ID, payload.ProjectID, "ADMIN"); !allowed {
		http.Error(w, msg, status)
		return
	}

	var nodesJSON, edgesJSON, viewportJSON string
	err = db.QueryRow("SELECT nodes_json, edges_json, viewport_json FROM canvas_states WHERE project_id = ?", payload.ProjectID).
		Scan(&nodesJSON, &edgesJSON, &viewportJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "This project has no canvas to contribute yet", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if nodesJSON == tNodes && edgesJSON == tEdges {
		http.Error(w, "This project's canvas is identical to the template, make a change first", http.StatusBadRequest)
		return
	}

	var pending int
	if err := db.QueryRow("SELECT COUNT(*) FROM template_contributions WHERE template_id = ? AND contributor_user_id = ? AND status = 'PENDING'", templateID, user.ID).Scan(&pending); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if pending > 0 {
		http.Error(w, "You already have a contribution waiting for review on this template", http.StatusConflict)
		return
	}

	id := "tcon_" + generateRandomHex(8)
	_, err = db.Exec(`
		INSERT INTO template_contributions (id, template_id, contributor_user_id, source_project_id, note, nodes_json, edges_json, viewport_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, templateID, user.ID, payload.ProjectID, note, nodesJSON, edgesJSON, viewportJSON)
	if err != nil {
		http.Error(w, "Failed to submit contribution: "+err.Error(), http.StatusInternalServerError)
		return
	}

	insertActivityEvent(payload.ProjectID, user.ID, "template.contribution_submitted", map[string]interface{}{"template_id": templateID})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
}

// GET /api/templates/{id}/contributions[?status=PENDING|ACCEPTED|REJECTED] —
// reviewers only (see canReviewTemplate). Includes each proposal's canvas.
func handleListTemplateContributions(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	templateID := r.PathValue("id")

	var authorID string
	err := db.QueryRow("SELECT author_user_id FROM templates WHERE id = ?", templateID).Scan(&authorID)
	if err == sql.ErrNoRows {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !canReviewTemplate(user, authorID) {
		http.Error(w, "Forbidden: only the template's author can review contributions", http.StatusForbidden)
		return
	}

	query := `SELECT c.id, c.template_id, c.contributor_user_id, COALESCE(u.name, ''), c.source_project_id, c.note, c.status,
			COALESCE(c.review_note, ''), c.created_at, c.reviewed_at, c.nodes_json, c.edges_json, c.viewport_json
		FROM template_contributions c LEFT JOIN users u ON u.id = c.contributor_user_id
		WHERE c.template_id = ?`
	args := []any{templateID}
	if st := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("status"))); st != "" {
		if st != "PENDING" && st != "ACCEPTED" && st != "REJECTED" {
			http.Error(w, "status must be PENDING, ACCEPTED or REJECTED", http.StatusBadRequest)
			return
		}
		query += " AND c.status = ?"
		args = append(args, st)
	}
	query += " ORDER BY c.created_at DESC LIMIT 100"

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []templateContribution{}
	for rows.Next() {
		var c templateContribution
		var src, reviewedAt sql.NullString
		if err := rows.Scan(&c.ID, &c.TemplateID, &c.ContributorID, &c.ContributorName, &src, &c.Note, &c.Status,
			&c.ReviewNote, &c.CreatedAt, &reviewedAt, &c.NodesJSON, &c.EdgesJSON, &c.ViewportJSON); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if src.Valid {
			c.SourceProjectID = &src.String
		}
		if reviewedAt.Valid {
			c.ReviewedAt = &reviewedAt.String
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"contributions": out})
}

// GET /api/contributions/mine — the caller's own submissions and their
// outcome, newest first. No canvas payload.
func handleListMyContributions(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	rows, err := db.Query(`
		SELECT c.id, c.template_id, COALESCE(t.title, ''), c.note, c.status, COALESCE(c.review_note, ''), c.created_at, c.reviewed_at
		FROM template_contributions c JOIN templates t ON t.id = c.template_id
		WHERE c.contributor_user_id = ? ORDER BY c.created_at DESC LIMIT 100`, user.ID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []templateContribution{}
	for rows.Next() {
		c := templateContribution{ContributorID: user.ID}
		var reviewedAt sql.NullString
		if err := rows.Scan(&c.ID, &c.TemplateID, &c.TemplateTitle, &c.Note, &c.Status, &c.ReviewNote, &c.CreatedAt, &reviewedAt); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if reviewedAt.Valid {
			c.ReviewedAt = &reviewedAt.String
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"contributions": out})
}

// POST /api/templates/{id}/contributions/{cid}/accept and .../reject —
// reviewers only. Accept replaces the template's canvas with the proposal in
// one transaction; other pending contributions are left pending (they were
// made against the previous canvas, so the reviewer sees them as they are).
func handleAcceptTemplateContribution(w http.ResponseWriter, r *http.Request) {
	reviewTemplateContribution(w, r, true)
}

func handleRejectTemplateContribution(w http.ResponseWriter, r *http.Request) {
	reviewTemplateContribution(w, r, false)
}

func reviewTemplateContribution(w http.ResponseWriter, r *http.Request, accept bool) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	templateID := r.PathValue("id")
	contributionID := r.PathValue("cid")

	var payload struct {
		ReviewNote string `json:"review_note"`
	}
	// An empty body is fine (accepting needs no note); only a malformed one is not.
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
			return
		}
	}
	reviewNote := strings.TrimSpace(payload.ReviewNote)
	if len([]rune(reviewNote)) > maxReviewNote {
		http.Error(w, fmt.Sprintf("Note must be %d characters or fewer", maxReviewNote), http.StatusBadRequest)
		return
	}

	var authorID string
	err := db.QueryRow("SELECT author_user_id FROM templates WHERE id = ?", templateID).Scan(&authorID)
	if err == sql.ErrNoRows {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !canReviewTemplate(user, authorID) {
		http.Error(w, "Forbidden: only the template's author can review contributions", http.StatusForbidden)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var nodesJSON, edgesJSON, viewportJSON string
	err = tx.QueryRow("SELECT nodes_json, edges_json, viewport_json FROM template_contributions WHERE id = ? AND template_id = ? AND status = 'PENDING'", contributionID, templateID).
		Scan(&nodesJSON, &edgesJSON, &viewportJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "Contribution not found or already reviewed", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	newStatus := "REJECTED"
	if accept {
		newStatus = "ACCEPTED"
	}
	// The status guard makes a concurrent double-review lose cleanly instead
	// of applying the canvas twice.
	res, err := tx.Exec("UPDATE template_contributions SET status = ?, reviewer_user_id = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING'",
		newStatus, user.ID, reviewNote, contributionID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "Contribution not found or already reviewed", http.StatusConflict)
		return
	}
	if accept {
		if _, err := tx.Exec("UPDATE templates SET nodes_json = ?, edges_json = ?, viewport_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
			nodesJSON, edgesJSON, viewportJSON, templateID); err != nil {
			http.Error(w, "Failed to apply contribution: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit transaction: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": newStatus})
}

// GET /api/contributions/pending — the caller's review inbox: PENDING
// contributions on templates they can review (their own, plus official ones
// when they are a curator). This is the only "notification" the author gets
// today; the dashboard shows it. No canvas payload.
func handleListPendingContributions(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	query := `SELECT c.id, c.template_id, COALESCE(t.title, ''), COALESCE(u.name, ''), c.note, c.created_at
		FROM template_contributions c
		JOIN templates t ON t.id = c.template_id
		LEFT JOIN users u ON u.id = c.contributor_user_id
		WHERE c.status = 'PENDING' AND (t.author_user_id = ?`
	args := []any{user.ID}
	if isTemplateCurator(user) {
		query += " OR t.author_user_id = ?"
		args = append(args, officialTemplateAuthor)
	}
	query += ") ORDER BY c.created_at DESC LIMIT 50"

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []templateContribution{}
	for rows.Next() {
		c := templateContribution{Status: "PENDING"}
		if err := rows.Scan(&c.ID, &c.TemplateID, &c.TemplateTitle, &c.ContributorName, &c.Note, &c.CreatedAt); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"contributions": out})
}
