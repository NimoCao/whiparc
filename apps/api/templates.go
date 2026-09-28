package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Template is a publicly browsable, forkable snapshot of a project's canvas.
// Unlike projects.visibility=PUBLIC (which lists a live, joinable project),
// a template is a frozen copy: publishing one does not change who can edit
// the source project, and editing the source project after publishing does
// not change the template. See product-memory 01.3 (whiparc/cloud) for the
// full data-model rationale.
type Template struct {
	ID              string    `json:"id"`
	SourceProjectID *string   `json:"source_project_id,omitempty"`
	AuthorUserID    string    `json:"author_user_id"`
	AuthorName      string    `json:"author_name,omitempty"`
	Title           string    `json:"title"`
	Description     string    `json:"description"`
	Category        string    `json:"category"`
	Tags            []string  `json:"tags"`
	InstallCount    int       `json:"install_count"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`

	// Canvas payload — populated on both the list and detail responses.
	// The catalog grid renders a mini preview of each card's own graph
	// (see product-memory 10.1), so every listed template needs it, not
	// just the one a visitor eventually opens.
	NodesJSON    string `json:"nodes_json,omitempty"`
	EdgesJSON    string `json:"edges_json,omitempty"`
	ViewportJSON string `json:"viewport_json,omitempty"`
}

func parseDBTimestamp(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t, _ = time.Parse("2006-01-02 15:04:05", s)
	}
	return t
}

func scanTemplateTags(tagsJSON string) []string {
	tags := []string{}
	_ = json.Unmarshal([]byte(tagsJSON), &tags)
	return tags
}

// GET /api/templates?q=&category=&tag=&sort=popular|newest&limit=&offset=
// Public — no auth required. Only PUBLISHED templates are ever listed here.
func handleListTemplates(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	sort := r.URL.Query().Get("sort")

	limit := 24
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 {
		limit = v
	}
	if limit > 100 {
		limit = 100
	}
	offset := 0
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v >= 0 {
		offset = v
	}

	where := []string{"t.status = 'PUBLISHED'"}
	args := []any{}

	if q != "" {
		where = append(where, "(t.title LIKE ? OR t.description LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like)
	}
	if category != "" {
		where = append(where, "t.category = ?")
		args = append(args, category)
	}
	if tag != "" {
		// Tags are stored as a JSON array TEXT column (no separate tags
		// table yet — see product-memory 07.2 "Technical Pitfalls" for
		// why a LIKE-on-JSON match is a known-limited stopgap: it can
		// false-positive on tag substrings, e.g. tag=aws also matching a
		// stored tag "aws-lambda"). Fine for the catalog's current scale.
		where = append(where, "t.tags LIKE ?")
		args = append(args, "%\""+tag+"\"%")
	}

	orderBy := "t.created_at DESC"
	if sort == "popular" {
		orderBy = "t.install_count DESC, t.created_at DESC"
	}

	countQuery := "SELECT COUNT(*) FROM templates t WHERE " + strings.Join(where, " AND ")
	var total int
	if err := db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// nodes_json/edges_json/viewport_json are included here (unlike the
	// original Phase 1 design, which omitted them from the list response
	// to keep the payload light) because the catalog grid now renders a
	// mini canvas preview as each card's body — every card needs its own
	// graph, not just the one a visitor eventually opens. At seed/MVP scale
	// (a handful to a few dozen templates) the added payload is trivial
	// (a few hundred bytes each); revisit with pagination or a lazy
	// per-card fetch if the catalog grows large enough for this to matter.
	listQuery := fmt.Sprintf(`
		SELECT t.id, t.source_project_id, t.author_user_id, COALESCE(u.name, ''), t.title, t.description,
		       t.category, t.tags, t.install_count, t.created_at, t.updated_at,
		       t.nodes_json, t.edges_json, t.viewport_json
		FROM templates t
		LEFT JOIN users u ON u.id = t.author_user_id
		WHERE %s
		ORDER BY %s
		LIMIT ? OFFSET ?`, strings.Join(where, " AND "), orderBy)

	rows, err := db.Query(listQuery, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	templates := []Template{}
	for rows.Next() {
		var t Template
		var sourceProjectID sql.NullString
		var tagsJSON, createdAtStr, updatedAtStr string
		err := rows.Scan(&t.ID, &sourceProjectID, &t.AuthorUserID, &t.AuthorName, &t.Title, &t.Description,
			&t.Category, &tagsJSON, &t.InstallCount, &createdAtStr, &updatedAtStr,
			&t.NodesJSON, &t.EdgesJSON, &t.ViewportJSON)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if sourceProjectID.Valid {
			t.SourceProjectID = &sourceProjectID.String
		}
		t.Tags = scanTemplateTags(tagsJSON)
		t.CreatedAt = parseDBTimestamp(createdAtStr)
		t.UpdatedAt = parseDBTimestamp(updatedAtStr)
		templates = append(templates, t)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"templates": templates,
		"total":     total,
		"limit":     limit,
		"offset":    offset,
	})
}

// GET /api/templates/{id} — public, includes the full canvas payload so a
// future "Get Started" flow (Phase 3) can fork it without a second call.
func handleGetTemplateByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var t Template
	var sourceProjectID sql.NullString
	var tagsJSON, createdAtStr, updatedAtStr string
	err := db.QueryRow(`
		SELECT t.id, t.source_project_id, t.author_user_id, COALESCE(u.name, ''), t.title, t.description,
		       t.category, t.tags, t.install_count, t.created_at, t.updated_at,
		       t.nodes_json, t.edges_json, t.viewport_json
		FROM templates t
		LEFT JOIN users u ON u.id = t.author_user_id
		WHERE t.id = ? AND t.status = 'PUBLISHED'`, id).Scan(
		&t.ID, &sourceProjectID, &t.AuthorUserID, &t.AuthorName, &t.Title, &t.Description,
		&t.Category, &tagsJSON, &t.InstallCount, &createdAtStr, &updatedAtStr,
		&t.NodesJSON, &t.EdgesJSON, &t.ViewportJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if sourceProjectID.Valid {
		t.SourceProjectID = &sourceProjectID.String
	}
	t.Tags = scanTemplateTags(tagsJSON)
	t.CreatedAt = parseDBTimestamp(createdAtStr)
	t.UpdatedAt = parseDBTimestamp(updatedAtStr)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(t)
}

// POST /api/templates/{id}/use — auth required. Forks a template's frozen
// canvas snapshot into a brand-new PRIVATE project inside the caller's own
// personal team, with no team picker needed for a zero-friction "Get
// Started" click. Every user gets exactly one personal team at signup
// (createPersonalTeam in auth.go), always at the deterministic slug
// "personal-<userID>", which is how it's resolved here. Never mutates the
// template's source project (if any) or the template itself beyond bumping
// install_count — templates are frozen snapshots, not live references.
func handleUseTemplate(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	templateID := r.PathValue("id")

	var title, nodesJSON, edgesJSON, viewportJSON string
	err := db.QueryRow(`SELECT title, nodes_json, edges_json, viewport_json FROM templates WHERE id = ? AND status = 'PUBLISHED'`, templateID).
		Scan(&title, &nodesJSON, &edgesJSON, &viewportJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var teamID string
	err = db.QueryRow("SELECT id FROM teams WHERE slug = ?", "personal-"+user.ID).Scan(&teamID)
	if err != nil {
		http.Error(w, "Could not resolve your personal workspace: "+err.Error(), http.StatusInternalServerError)
		return
	}

	projectID := fmt.Sprintf("proj_%d", time.Now().UnixNano())

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec("INSERT INTO projects (id, team_id, name, description, visibility, created_by) VALUES (?, ?, ?, ?, 'PRIVATE', ?)",
		projectID, teamID, title, "Forked from the \""+title+"\" template.", user.ID)
	if err != nil {
		http.Error(w, "Failed to create project: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Mirrors handleCreateProject: an explicit project_members ADMIN row
	// alongside created_by, since other endpoints (e.g. handleGetProjectMembers)
	// read membership from project_members directly rather than inferring it.
	pmID := fmt.Sprintf("pmem_%d", time.Now().UnixNano())
	_, err = tx.Exec("INSERT INTO project_members (id, project_id, user_id, role, added_by) VALUES (?, ?, ?, 'ADMIN', ?)",
		pmID, projectID, user.ID, user.ID)
	if err != nil {
		http.Error(w, "Failed to assign project access: "+err.Error(), http.StatusInternalServerError)
		return
	}

	_, err = tx.Exec("INSERT INTO canvas_states (project_id, nodes_json, edges_json, viewport_json, updated_by) VALUES (?, ?, ?, ?, ?)",
		projectID, nodesJSON, edgesJSON, viewportJSON, user.ID)
	if err != nil {
		http.Error(w, "Failed to initialize canvas state: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err = tx.Exec("UPDATE templates SET install_count = install_count + 1 WHERE id = ?", templateID); err != nil {
		http.Error(w, "Failed to update template install count: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit transaction: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"project_id": projectID})
}

// POST /api/projects/{id}/templates — publishes a snapshot of a project's
// current canvas as a new public template. Nested under /api/projects/{id}
// (not a flat POST /api/templates with project_id in the body) specifically
// so it can reuse RequireProjectRole("ADMIN") exactly as every other
// project-scoped write route does, instead of a bespoke membership check.
// MVP publish is auto-publish, no review queue (product decision — see
// product-memory 10.1) — the new row is 'PUBLISHED' immediately.
func handlePublishProjectAsTemplate(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	projectID := r.PathValue("id")

	var payload struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Category    string   `json:"category"`
		Tags        []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	title := strings.TrimSpace(payload.Title)
	if title == "" {
		http.Error(w, "Title is required", http.StatusBadRequest)
		return
	}
	category := strings.TrimSpace(payload.Category)
	if category == "" {
		category = "General"
	}
	tags := payload.Tags
	if tags == nil {
		tags = []string{}
	}

	var nodesJSON, edgesJSON, viewportJSON string
	err := db.QueryRow("SELECT nodes_json, edges_json, viewport_json FROM canvas_states WHERE project_id = ?", projectID).
		Scan(&nodesJSON, &edgesJSON, &viewportJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "This project has no canvas to publish yet", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		http.Error(w, "Invalid tags: "+err.Error(), http.StatusBadRequest)
		return
	}

	templateID := fmt.Sprintf("tmpl_%d", time.Now().UnixNano())
	_, err = db.Exec(`
		INSERT INTO templates (id, source_project_id, author_user_id, title, description, category, tags, nodes_json, edges_json, viewport_json, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED')`,
		templateID, projectID, user.ID, title, payload.Description, category, string(tagsJSON), nodesJSON, edgesJSON, viewportJSON)
	if err != nil {
		http.Error(w, "Failed to publish template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	insertActivityEvent(projectID, user.ID, "template.published", map[string]interface{}{"title": title})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"id": templateID})
}

// PATCH /api/templates/{id} — auth required, owner-only (author_user_id must
// match the caller; official seeded templates have the 'whiparc_official'
// sentinel as their author, which no real user can ever match, so they're
// implicitly un-editable through this route without special-casing it).
// Edits metadata and/or toggles status between PUBLISHED/UNPUBLISHED — the
// "unpublish" action Phase 1's status column was added ahead of need for.
func handleUpdateTemplate(w http.ResponseWriter, r *http.Request) {
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
	if authorID != user.ID {
		http.Error(w, "Forbidden: you can only edit templates you published", http.StatusForbidden)
		return
	}

	var payload struct {
		Title       *string   `json:"title"`
		Description *string   `json:"description"`
		Category    *string   `json:"category"`
		Tags        *[]string `json:"tags"`
		Status      *string   `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	if payload.Status != nil && *payload.Status != "PUBLISHED" && *payload.Status != "UNPUBLISHED" {
		http.Error(w, "status must be PUBLISHED or UNPUBLISHED", http.StatusBadRequest)
		return
	}

	if payload.Title != nil {
		title := strings.TrimSpace(*payload.Title)
		if title == "" {
			http.Error(w, "Title cannot be empty", http.StatusBadRequest)
			return
		}
		if _, err := db.Exec("UPDATE templates SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", title, templateID); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if payload.Description != nil {
		if _, err := db.Exec("UPDATE templates SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", *payload.Description, templateID); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if payload.Category != nil {
		category := strings.TrimSpace(*payload.Category)
		if category == "" {
			category = "General"
		}
		if _, err := db.Exec("UPDATE templates SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", category, templateID); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if payload.Tags != nil {
		tagsJSON, err := json.Marshal(*payload.Tags)
		if err != nil {
			http.Error(w, "Invalid tags: "+err.Error(), http.StatusBadRequest)
			return
		}
		if _, err := db.Exec("UPDATE templates SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", string(tagsJSON), templateID); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if payload.Status != nil {
		if _, err := db.Exec("UPDATE templates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", *payload.Status, templateID); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// DELETE /api/templates/{id} — auth required, owner-only. Permanently
// removes the template (distinct from PATCH's status=UNPUBLISHED, which is
// reversible); the source project itself is never touched either way.
func handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
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
	if authorID != user.ID {
		http.Error(w, "Forbidden: you can only delete templates you published", http.StatusForbidden)
		return
	}

	if _, err := db.Exec("DELETE FROM templates WHERE id = ?", templateID); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// seedOfficialTemplates seeds a handful of curated, official templates on
// first boot so /templates has content before the publish flow (Phase 5)
// ships. Officially-authored templates have source_project_id = NULL and
// author_user_id = "whiparc_official" (a sentinel, not a real users row —
// deliberately not FK'd to users so seeding doesn't depend on any account
// existing yet). Idempotent: no-ops if templates already exist.
//
// NOTE: the node/edge graphs below are intentionally minimal placeholders
// (customNode entries with plausible labels, not fully-parameterized nodes
// matching every field the canvas editor can produce). They're enough to
// exercise list/detail/fork end-to-end; richer, hand-authored graphs should
// replace them before this feature is publicly launched. Tracked in
// product-memory 08.1 (Non-Implemented & Mocked Features).
func seedOfficialTemplates() error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM templates").Scan(&count); err != nil {
		return fmt.Errorf("failed to count templates: %w", err)
	}
	if count > 0 {
		return nil
	}

	type seed struct {
		title, description, category string
		tags                          []string
		nodes                         []map[string]any
		edges                         []map[string]any
	}

	seeds := []seed{
		{
			title:       "AWS Web Server + Security Group",
			description: "A single EC2 instance behind a security group — the fastest way to get a public web server running on AWS.",
			category:    "AWS",
			tags:        []string{"aws", "ec2", "beginner"},
			nodes: []map[string]any{
				{"id": "sg_1", "type": "customNode", "position": map[string]int{"x": 100, "y": 100},
					"data": map[string]any{"label": "Security Group", "tech": "Terraform", "icon": "lucide:shield", "categoryLabel": "AWS Resource", "description": "Allows HTTP/HTTPS/SSH", "status": "Validated"}},
				{"id": "web_1", "type": "customNode", "position": map[string]int{"x": 400, "y": 100},
					"data": map[string]any{"label": "Web Server", "tech": "Terraform", "icon": "lucide:server", "categoryLabel": "AWS Resource", "description": "EC2 instance", "status": "Validated"}},
			},
			edges: []map[string]any{
				{"id": "e_sg_web", "source": "sg_1", "target": "web_1"},
			},
		},
		{
			title:       "Three-Tier Web App (EC2 + RDS)",
			description: "Web server, application server, and a managed Postgres database — a classic three-tier starting point.",
			category:    "AWS",
			tags:        []string{"aws", "ec2", "rds", "postgres"},
			nodes: []map[string]any{
				{"id": "web_1", "type": "customNode", "position": map[string]int{"x": 100, "y": 100},
					"data": map[string]any{"label": "Web Server", "tech": "Terraform", "icon": "lucide:server", "categoryLabel": "AWS Resource", "status": "Validated"}},
				{"id": "app_1", "type": "customNode", "position": map[string]int{"x": 400, "y": 100},
					"data": map[string]any{"label": "App Server", "tech": "Terraform", "icon": "lucide:server", "categoryLabel": "AWS Resource", "status": "Validated"}},
				{"id": "db_1", "type": "customNode", "position": map[string]int{"x": 700, "y": 100},
					"data": map[string]any{"label": "Postgres (RDS)", "tech": "Terraform", "icon": "lucide:database", "categoryLabel": "AWS Resource", "status": "Validated"}},
			},
			edges: []map[string]any{
				{"id": "e_web_app", "source": "web_1", "target": "app_1"},
				{"id": "e_app_db", "source": "app_1", "target": "db_1"},
			},
		},
		{
			title:       "Kubernetes Deployment + Service",
			description: "A Deployment fronted by a Service — the minimal building block for running a containerized app on Kubernetes.",
			category:    "Kubernetes",
			tags:        []string{"kubernetes", "k8s", "beginner"},
			nodes: []map[string]any{
				{"id": "deploy_1", "type": "customNode", "position": map[string]int{"x": 100, "y": 100},
					"data": map[string]any{"label": "Deployment", "tech": "Kubernetes", "icon": "lucide:layers", "categoryLabel": "K8s Resource", "status": "Validated"}},
				{"id": "svc_1", "type": "customNode", "position": map[string]int{"x": 400, "y": 100},
					"data": map[string]any{"label": "Service", "tech": "Kubernetes", "icon": "lucide:external-link", "categoryLabel": "K8s Resource", "status": "Validated"}},
			},
			edges: []map[string]any{
				{"id": "e_deploy_svc", "source": "deploy_1", "target": "svc_1"},
			},
		},
		{
			title:       "Ansible Provisioned App Server",
			description: "A target host provisioned by an Ansible playbook — install dependencies and deploy an app in one pass.",
			category:    "Ansible",
			tags:        []string{"ansible", "provisioning"},
			nodes: []map[string]any{
				{"id": "target_1", "type": "customNode", "position": map[string]int{"x": 100, "y": 100},
					"data": map[string]any{"label": "Target Host", "tech": "Target", "icon": "lucide:cloud", "categoryLabel": "Cloud Target", "status": "Validated"}},
				{"id": "playbook_1", "type": "customNode", "position": map[string]int{"x": 400, "y": 100},
					"data": map[string]any{"label": "App Provisioning", "tech": "Ansible", "icon": "lucide:terminal", "categoryLabel": "Ansible Task", "status": "Validated"}},
			},
			edges: []map[string]any{
				{"id": "e_target_playbook", "source": "target_1", "target": "playbook_1"},
			},
		},
	}

	for _, s := range seeds {
		id := fmt.Sprintf("tmpl_%d", time.Now().UnixNano())
		nodesJSON, err := json.Marshal(s.nodes)
		if err != nil {
			return fmt.Errorf("failed to marshal seed nodes for %q: %w", s.title, err)
		}
		edgesJSON, err := json.Marshal(s.edges)
		if err != nil {
			return fmt.Errorf("failed to marshal seed edges for %q: %w", s.title, err)
		}
		tagsJSON, err := json.Marshal(s.tags)
		if err != nil {
			return fmt.Errorf("failed to marshal seed tags for %q: %w", s.title, err)
		}

		_, err = db.Exec(`
			INSERT INTO templates (id, source_project_id, author_user_id, title, description, category, tags, nodes_json, edges_json, viewport_json, status)
			VALUES (?, NULL, 'whiparc_official', ?, ?, ?, ?, ?, ?, '{"x":0,"y":0,"zoom":1}', 'PUBLISHED')`,
			id, s.title, s.description, s.category, string(tagsJSON), string(nodesJSON), string(edgesJSON))
		if err != nil {
			return fmt.Errorf("failed to seed template %q: %w", s.title, err)
		}
		// Stagger nanosecond-based IDs so seeds don't collide when the
		// loop runs faster than the clock's resolution on some platforms.
		time.Sleep(time.Microsecond)
	}

	return nil
}
