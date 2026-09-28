package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"api/importer"
	"api/runner"
	"api/vault"

	"github.com/gorilla/websocket"
	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/ssh"
	_ "modernc.org/sqlite"
)

// maxPipelineLogBytes caps what gets persisted to pipeline_runs.logs once a
// run finishes. Without this, a busy project's untruncated deploy logs are
// the fastest way to eat a hosted Postgres free tier's storage quota — the
// live WebSocket stream a client is watching during the run is always the
// full, untruncated log; only the at-rest copy written at completion is
// capped, keeping the tail (the part worth re-reading after the fact).
const maxPipelineLogBytes = 200_000

func truncateLogs(logs string) string {
	if len(logs) <= maxPipelineLogBytes {
		return logs
	}
	return logs[len(logs)-maxPipelineLogBytes:] + "\n...truncated..."
}

type PipelineRun struct {
	ID          string           `json:"id"`
	Status      string           `json:"status"` // PENDING, RUNNING, SUCCESS, FAILED
	Logs        string           `json:"logs"`
	Canvas      string           `json:"canvas"`
	RunType     *string          `json:"runType"`
	Target      *string          `json:"target"`
	TriggeredBy *TriggeredByInfo `json:"triggeredBy"`
	CreatedAt   time.Time        `json:"createdAt"`
	UpdatedAt   time.Time        `json:"updatedAt"`
}

// TriggeredByInfo is populated from a LEFT JOIN against users at read time
// rather than a denormalized column on pipeline_runs — see
// obsidian_memory/08.6 section 2.3. Nil (serializes as JSON null) when
// user_id is NULL, either because the run predates that column or because
// its user was later removed.
type TriggeredByInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// deriveRunTarget scans a run's canvas for the first node with a non-empty
// Data.Environment and formats a short human-readable target string. Kept
// deliberately simple (first match wins, no multi-cloud/"mixed" labels) per
// obsidian_memory/08.6 section 2.4 — no mockup or backlog item asks for
// more, and it adds real complexity for a case that doesn't exist in current
// seed data or templates. Returns "" (stored as NULL) when no node declares
// an environment.
func deriveRunTarget(canvasStr string) string {
	var canvas struct {
		Nodes []importer.CanvasNode `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(canvasStr), &canvas); err != nil {
		return ""
	}
	for _, node := range canvas.Nodes {
		env := node.Data.Environment
		if env == "" {
			continue
		}
		switch env {
		case "aws":
			if node.Data.Region != "" {
				return "AWS · " + node.Data.Region
			}
			return "AWS"
		case "gcp":
			if node.Data.GcpZone != "" {
				return "GCP · " + node.Data.GcpZone
			}
			return "GCP"
		default:
			return strings.ToUpper(env)
		}
	}
	return ""
}

// nullIfEmpty lets an empty derived target be stored as SQL NULL (renders
// "—" client-side) instead of an empty string, matching the "no node had an
// environment set" case to "not implemented yet" rather than a distinct
// empty-but-present value — see obsidian_memory/08.6 section 2.4.
func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

type RunTracker struct {
	sync.Mutex
	clients      map[*websocket.Conn]bool
	logs         string
	status       string
	nodeStatuses map[string]string // nodeId → latest status; replayed to late-connecting WS clients
}

var (
	db            *dbHandle
	dbBackend     string // "sqlite" (default) or "postgres" — set once in main()
	upgrader      = websocket.Upgrader{CheckOrigin: checkWebsocketOrigin}
	trackers      = make(map[string]*RunTracker)
	trackersMutex sync.Mutex
	emailSender   EmailSender
	signupLimiter *RateLimiter
	loginLimiter  *RateLimiter
	resendLimiter *RateLimiter
)

// waitForPostgres retries the initial ping instead of failing on first
// contact. docker-compose.hosted.yml's `depends_on: condition: service_healthy`
// only guarantees pg_isready succeeded once — the official postgres image
// runs a one-time initdb pass through a temporary server and then bounces
// into the real one, and pg_isready can report ready against that temp
// server moments before the bounce. A connection landing in that gap sees
// "the database system is starting up" (SQLSTATE 57P03) even though the
// container is seconds from being usable, so a single failed attempt here
// isn't a real failure — it's worth a bounded retry before giving up.
func waitForPostgres(rawDB *sql.DB) error {
	const maxAttempts = 30
	const retryDelay = 2 * time.Second

	var err error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err = rawDB.Ping(); err == nil {
			return nil
		}
		log.Printf("[DB] Postgres not ready yet (attempt %d/%d): %v\n", attempt, maxAttempts, err)
		time.Sleep(retryDelay)
	}
	return err
}

func main() {
	log.Println("===================================================")
	log.Println("  Whiparc Runner Go Backend Initialization   ")
	log.Println("===================================================")

	dbBackend = strings.ToLower(os.Getenv("DB_DRIVER"))
	if dbBackend == "" {
		dbBackend = "sqlite"
	}

	var rawDB *sql.DB
	var err error

	switch dbBackend {
	case "postgres":
		dsn := os.Getenv("DATABASE_URL")
		if dsn == "" {
			log.Fatalf("[DB] DB_DRIVER=postgres requires DATABASE_URL to be set\n")
		}
		log.Println("[DB] Connecting to postgres")
		rawDB, err = sql.Open("pgx", dsn)
		if err != nil {
			log.Fatalf("[DB] Failed to open database: %v\n", err)
		}
		// A real connection pool, unlike SQLite's forced single connection
		// below — Postgres handles concurrent writers natively, so raising
		// this is what actually buys the throughput this migration is for.
		rawDB.SetMaxOpenConns(20)
		if err := waitForPostgres(rawDB); err != nil {
			log.Fatalf("[DB] Postgres never became ready: %v\n", err)
		}
	default:
		dbBackend = "sqlite"
		// Ensure the db folder exists
		dbDir := "/app/data"
		if os.Getenv("IS_DOCKER") != "true" {
			dbDir = "./data"
		}
		_ = os.MkdirAll(dbDir, 0755)

		dbPath := filepath.Join(dbDir, "dev.db")
		log.Printf("[DB] Connecting to sqlite at %s\n", dbPath)

		rawDB, err = sql.Open("sqlite", dbPath)
		if err != nil {
			log.Fatalf("[DB] Failed to open database: %v\n", err)
		}

		// SQLite only ever allows one writer at a time, but database/sql's
		// connection pool opens multiple physical connections to this file by
		// default — a second writer then gets an immediate "database is locked"
		// error (SQLITE_BUSY) instead of waiting, since no busy_timeout is set.
		// Forcing a single connection makes Go's pool respect SQLite's actual
		// concurrency model instead of fighting it; busy_timeout is kept as a
		// belt-and-suspenders guard against an external lock (e.g. a manual
		// sqlite3 CLI session touching the same file). See
		// obsidian_memory/07.2 for the incident this was found from.
		rawDB.SetMaxOpenConns(1)
		if _, err := rawDB.Exec("PRAGMA busy_timeout = 5000;"); err != nil {
			log.Fatalf("[DB] Failed to set busy_timeout pragma: %v\n", err)
		}
	}

	db = &dbHandle{DB: rawDB, backend: dbBackend}
	defer db.Close()

	// Create table if not exists
	schemaQuery := sqliteSchemaSQL
	if dbBackend == "postgres" {
		schemaQuery = pgSchema(schemaQuery)
	}
	if _, err := db.Exec(schemaQuery); err != nil {
		log.Fatalf("[DB] Failed to initialize schema: %v\n", err)
	}

	// Run migrations to alter existing pipeline_runs table columns safely.
	// Postgres supports ADD COLUMN IF NOT EXISTS natively, so it doesn't need
	// SQLite's "just ignore the duplicate-column error" approach.
	addColumnIfNotExists := ""
	if dbBackend == "postgres" {
		addColumnIfNotExists = " IF NOT EXISTS"
	}
	_, _ = db.Exec(fmt.Sprintf("ALTER TABLE pipeline_runs ADD COLUMN%s project_id TEXT;", addColumnIfNotExists))
	_, _ = db.Exec(fmt.Sprintf("ALTER TABLE pipeline_runs ADD COLUMN%s user_id TEXT;", addColumnIfNotExists))
	_, _ = db.Exec(fmt.Sprintf("ALTER TABLE users ADD COLUMN%s plan TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO', 'ENTERPRISE'));", addColumnIfNotExists))

	// The three migrations below exist only to bring a *pre-existing* SQLite
	// database's constraints up to date with schemaQuery above (rebuilding a
	// table is SQLite's only way to relax a NOT NULL or widen a CHECK
	// constraint). schemaQuery already creates a fresh Postgres database with
	// every one of these constraints in its final shape, and they lean on
	// SQLite-only introspection (PRAGMA table_info, sqlite_master) that has
	// no Postgres equivalent — so there is nothing for them to do there.
	if dbBackend == "sqlite" {
		if err := migrateUsersPasswordHashNullable(); err != nil {
			log.Fatalf("[DB] Failed to migrate users.password_hash to nullable: %v\n", err)
		}
		if err := migrateCloudCredentialsProviderGithub(); err != nil {
			log.Fatalf("[DB] Failed to migrate cloud_credentials to allow GITHUB: %v\n", err)
		}
		if err := migratePairedAgentsStatusAllowsDisconnected(); err != nil {
			log.Fatalf("[DB] Failed to migrate paired_agents.status CHECK constraint: %v\n", err)
		}
	}
	if err := runMigrations(db); err != nil {
		log.Fatalf("[DB] Failed to run migrations: %v\n", err)
	}
	if err := seedOfficialTemplates(); err != nil {
		log.Fatalf("[DB] Failed to seed official templates: %v\n", err)
	}
	log.Println("[DB] Database initialized successfully.")

	// Initialize mailer and rate limiters
	emailSender = NewEmailSender()
	signupLimiter = NewRateLimiter(5, 1*time.Hour, 5)       // 5 signups per hour per IP
	loginLimiter = NewRateLimiter(10, 15*time.Minute, 10)   // 10 logins per 15 min per IP
	resendLimiter = NewRateLimiter(3, 15*time.Minute, 3)    // 3 resends per 15 min per user/IP

	// Set up routing
	mux := http.NewServeMux()

	// Unauthenticated — polled by the reverse proxy / uptime monitor.
	mux.HandleFunc("GET /healthz", handleHealthz)

	// API Routes
	mux.Handle("GET /api/projects/{id}/runs", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleGetRuns))))
	mux.HandleFunc("GET /api/runs/{id}", enableCORS(handleGetRunByID))
	mux.Handle("POST /api/projects/{id}/deploy", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleDeploy))))
	mux.Handle("POST /api/projects/{id}/destroy", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleDestroy))))
	mux.Handle("POST /api/projects/{id}/plan", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handlePlan))))
	mux.HandleFunc("/api/ws/runs/{id}", handleWebSocket)

	// Auth & Workspace Sync Routes
	mux.HandleFunc("POST /api/auth/signup", enableCORS(handleSignup))
	mux.HandleFunc("POST /api/auth/login", enableCORS(handleLogin))
	mux.HandleFunc("POST /api/auth/verify-email", enableCORS(handleVerifyEmail))
	mux.HandleFunc("GET /api/auth/verify-email", enableCORS(handleVerifyEmail))
	mux.Handle("POST /api/auth/resend-verification", AuthMiddleware(http.HandlerFunc(handleResendVerification)))
	mux.Handle("POST /api/auth/upgrade", AuthMiddleware(http.HandlerFunc(handleUpgradePlan)))
	mux.Handle("GET /api/auth/me", AuthMiddleware(http.HandlerFunc(handleMe)))
	mux.Handle("PATCH /api/auth/onboarding", AuthMiddleware(http.HandlerFunc(handleDismissOnboarding)))
	mux.Handle("GET /api/activity", AuthMiddleware(http.HandlerFunc(handleGetActivity)))
	mux.HandleFunc("GET /api/auth/{provider}/login", handleOAuthLogin)
	mux.HandleFunc("GET /api/auth/{provider}/callback", handleOAuthCallback)
	mux.HandleFunc("GET /api/workspace/{projectId}/sync", handleWorkspaceWebSocketSync)

	// Team Routes
	mux.Handle("GET /api/teams", AuthMiddleware(http.HandlerFunc(handleGetTeams)))
	mux.Handle("POST /api/teams", AuthMiddleware(http.HandlerFunc(handleCreateTeam)))

	// Project Routes
	mux.Handle("GET /api/projects", AuthMiddleware(http.HandlerFunc(handleGetProjects)))
	mux.Handle("POST /api/projects", AuthMiddleware(http.HandlerFunc(handleCreateProject)))
	mux.Handle("GET /api/projects/{id}", AuthMiddleware(http.HandlerFunc(handleGetProjectByID)))
	mux.Handle("PATCH /api/projects/{id}", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handleUpdateProject))))
	mux.Handle("DELETE /api/projects/{id}", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handleDeleteProject))))
	mux.Handle("GET /api/projects/{id}/canvas", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleGetCanvasState))))
	mux.Handle("PUT /api/projects/{id}/canvas", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleUpdateCanvasState))))
	mux.Handle("POST /api/projects/{id}/import", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleImport))))
	mux.Handle("GET /api/projects/{id}/credentials", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleGetProjectCredentials))))
	mux.Handle("POST /api/projects/{id}/credentials", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleCreateProjectCredential))))
	mux.Handle("DELETE /api/projects/{id}/credentials/{credId}", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleDeleteProjectCredential))))
	mux.Handle("POST /api/projects/{id}/templates", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handlePublishProjectAsTemplate))))
	mux.Handle("GET /api/projects/{id}/members", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleGetProjectMembers))))
	mux.Handle("POST /api/projects/{id}/members", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handleAddProjectMember))))
	mux.Handle("PUT /api/projects/{id}/members/{userId}", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handleUpdateProjectMemberRole))))
	mux.Handle("DELETE /api/projects/{id}/members/{userId}", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handleRemoveProjectMember))))

	// Custom Nodes Routes
	mux.HandleFunc("POST /api/custom-nodes/validate", handleValidateCustomNode)
	mux.Handle("GET /api/projects/{id}/custom-nodes", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleGetCustomNodes))))
	mux.Handle("POST /api/projects/{id}/custom-nodes", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleCreateCustomNode))))
	mux.Handle("DELETE /api/projects/{id}/custom-nodes/{nodeId}", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleDeleteCustomNode))))

	// Template Catalog Routes (public, no auth — see product-memory 01.3
	// and 08.1 in whiparc/cloud for schema rationale and MVP scope notes)
	mux.HandleFunc("GET /api/templates", enableCORS(handleListTemplates))
	mux.HandleFunc("GET /api/templates/{id}", enableCORS(handleGetTemplateByID))
	mux.Handle("POST /api/templates/{id}/use", AuthMiddleware(http.HandlerFunc(handleUseTemplate)))
	mux.Handle("PATCH /api/templates/{id}", AuthMiddleware(http.HandlerFunc(handleUpdateTemplate)))
	mux.Handle("DELETE /api/templates/{id}", AuthMiddleware(http.HandlerFunc(handleDeleteTemplate)))

	// Join Requests
	mux.Handle("POST /api/projects/{id}/join-request", AuthMiddleware(http.HandlerFunc(handleCreateJoinRequest)))
	mux.Handle("GET /api/projects/{id}/join-requests", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handleGetJoinRequests))))
	mux.Handle("POST /api/projects/{id}/join-requests/{reqId}/approve", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handleApproveJoinRequest))))
	mux.Handle("POST /api/projects/{id}/join-requests/{reqId}/reject", AuthMiddleware(RequireProjectRole("ADMIN")(http.HandlerFunc(handleRejectJoinRequest))))

	// Sandbox Agent Routes (Phase 1 opt-in beta — see obsidian_memory/08.4)
	if os.Getenv("SANDBOX_AGENT_BETA") == "true" {
		mux.Handle("POST /api/projects/{id}/agents/register", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleRegisterAgent))))
		mux.Handle("POST /api/projects/{id}/agents/pair", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handlePairAgent))))
		mux.Handle("GET /api/projects/{id}/agents/latest", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleGetLatestAgentStatus))))
		mux.Handle("GET /api/projects/{id}/agents", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleListAgents))))
		mux.Handle("POST /api/projects/{id}/agents/{agentId}/revoke", AuthMiddleware(RequireProjectRole("EDITOR")(http.HandlerFunc(handleRevokeAgent))))
		mux.Handle("GET /api/projects/{id}/sandbox-migration-status", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleGetSandboxMigrationStatus))))
		mux.Handle("GET /api/projects/{id}/agents/{agentId}", AuthMiddleware(RequireProjectRole("VIEWER")(http.HandlerFunc(handleGetAgentStatus))))
		mux.HandleFunc("POST /api/internal/agents/{agentId}/callback", handleAgentStatusCallback)
		mux.HandleFunc("POST /api/internal/agent-tokens", handleRegisterAgentToken)
		mux.HandleFunc("POST /api/internal/agent-tokens/validate", handleValidateAgentToken)
		log.Println("[SANDBOX AGENT] Beta routes registered (SANDBOX_AGENT_BETA=true)")
	}

	// Version list for the docs site's install-guide picker (current
	// latest, previous versions, beta builds) — see cli_releases.go.
	mux.HandleFunc("GET /api/cli/releases", enableCORS(handleGetCLIReleases))

	// Static downloads serving with fallback redirection to GitHub Releases
	_ = os.MkdirAll("./static/downloads", 0755)
	mux.Handle("GET /downloads/{filename...}", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		filename := r.PathValue("filename")
		if filename == "" || filename == "/" {
			http.NotFound(w, r)
			return
		}
		localPath := filepath.Join("./static/downloads", filename)
		if _, err := os.Stat(localPath); err == nil {
			http.ServeFile(w, r, localPath)
			return
		}
		githubURL := "https://github.com/whiparc/whiparc/releases/latest/download/" + filename
		http.Redirect(w, r, githubURL, http.StatusTemporaryRedirect)
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("[SERVER] Listening on port %s\n", port)
	if err := http.ListenAndServe(":"+port, CORSWrapper(mux)); err != nil {
		log.Fatalf("[SERVER] ListenAndServe failed: %v\n", err)
	}
}

// allowedOrigin returns the single origin the API accepts cross-origin
// requests from. FRONTEND_URL is already the production-vs-dev switch this
// codebase uses for the OAuth redirect target (see oauth.go), so it doubles
// as the CORS allowlist instead of introducing a second env var that could
// drift from it — in production this must be set to https://whiparc.com; the
// "*" fallback only exists so local dev (no env vars set) keeps working.
func allowedOrigin() string {
	if v := os.Getenv("FRONTEND_URL"); v != "" {
		return v
	}
	return "*"
}

// checkWebsocketOrigin gates the WebSocket upgrader the same way as the
// plain HTTP CORS helpers below — an open CheckOrigin (the previous
// `return true` default) lets any site's browser JS open a run's live log
// stream on a signed-in user's behalf.
func checkWebsocketOrigin(r *http.Request) bool {
	allowed := allowedOrigin()
	if allowed == "*" {
		return true
	}
	return r.Header.Get("Origin") == allowed
}

// CORSWrapper handles CORS for all incoming API routes and intercepts OPTIONS preflight requests
func CORSWrapper(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// CORS Helper middleware
func enableCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func handleOptions(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.WriteHeader(http.StatusOK)
}

// handleHealthz is polled by the reverse proxy / uptime monitor in
// production — it only reports healthy once the DB connection this process
// opened at startup is actually reachable, so a Postgres outage (or a
// SQLite file gone missing) shows up as a failing health check instead of a
// misleadingly-alive process.
func handleHealthz(w http.ResponseWriter, r *http.Request) {
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("db unreachable: " + err.Error()))
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// runsWithTriggeredByQuery is shared by handleGetRuns and handleGetRunByID.
// LEFT JOIN (not INNER) so rows with user_id IS NULL — pre-existing rows
// from before the user_id column even existed — still return, with
// name/email as SQL NULL, surfaced as triggeredBy: null client-side. See
// obsidian_memory/08.6 section 2.3.
const runsWithTriggeredByQuery = `SELECT pr.id, pr.status, pr.logs, pr.canvas, pr.run_type, pr.target,
       pr.user_id, u.name, u.email, pr.created_at, pr.updated_at
FROM pipeline_runs pr
LEFT JOIN users u ON pr.user_id = u.id`

func scanPipelineRun(scanner interface{ Scan(...any) error }) (PipelineRun, error) {
	var run PipelineRun
	var runType, target, userID, userName, userEmail sql.NullString
	// Scanned directly into time.Time rather than a string re-parsed with a
	// fixed layout: modernc.org/sqlite returns a DATETIME column's value
	// already as RFC3339 ("2026-09-22T11:40:14Z") when the destination is a
	// string, which the previous "2006-01-02 15:04:05" layout (matched to
	// SQLite's own datetime('now') text format) couldn't parse — it failed
	// silently (error discarded) on every row, leaving CreatedAt/UpdatedAt
	// at Go's zero value and rendering as "739880d ago" client-side. Both
	// database/sql drivers used here (modernc.org/sqlite, pgx/v5/stdlib)
	// natively support scanning a timestamp column straight into time.Time.
	err := scanner.Scan(&run.ID, &run.Status, &run.Logs, &run.Canvas, &runType, &target,
		&userID, &userName, &userEmail, &run.CreatedAt, &run.UpdatedAt)
	if err != nil {
		return run, err
	}
	if runType.Valid {
		run.RunType = &runType.String
	}
	if target.Valid {
		run.Target = &target.String
	}
	if userID.Valid {
		run.TriggeredBy = &TriggeredByInfo{ID: userID.String, Name: userName.String, Email: userEmail.String}
	}
	return run, nil
}

func handleGetRuns(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	rows, err := db.Query(runsWithTriggeredByQuery+" WHERE pr.project_id = ? ORDER BY pr.created_at DESC", projectID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	runs := []PipelineRun{}
	for rows.Next() {
		run, err := scanPipelineRun(rows)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		runs = append(runs, run)
	}
	if err = rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(runs)
}

func handleGetRunByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing run ID", http.StatusBadRequest)
		return
	}

	row := db.QueryRow(runsWithTriggeredByQuery+" WHERE pr.id = ?", id)
	run, err := scanPipelineRun(row)
	if err == sql.ErrNoRows {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Run not found"})
		return
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	trackersMutex.Lock()
	tracker, active := trackers[id]
	trackersMutex.Unlock()

	if active {
		tracker.Lock()
		run.Logs = tracker.logs
		tracker.Unlock()
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(run)
}

type DeployPayload struct {
	Canvas      interface{}       `json:"canvas"`
	Files       []runner.FileItem `json:"files"`
	AutoDestroy bool              `json:"autoDestroy"`
}

func handleDeploy(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, _ := GetUserFromContext(r)

	var payload DeployPayload
	err := json.NewDecoder(r.Body).Decode(&payload)
	if err != nil {
		http.Error(w, "Invalid request payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	var canvasStr string
	var canvasNodesJSON, canvasEdgesJSON string

	if payload.Canvas == nil {
		err = db.QueryRow("SELECT nodes_json, edges_json FROM canvas_states WHERE project_id = ?", projectID).Scan(&canvasNodesJSON, &canvasEdgesJSON)
		if err == sql.ErrNoRows {
			canvasNodesJSON = "[]"
			canvasEdgesJSON = "[]"
		} else if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		canvasStr = fmt.Sprintf(`{"nodes":%s,"edges":%s}`, canvasNodesJSON, canvasEdgesJSON)
	} else {
		canvasBytes, err := json.Marshal(payload.Canvas)
		if err != nil {
			http.Error(w, "Invalid canvas format", http.StatusBadRequest)
			return
		}
		canvasStr = string(canvasBytes)
		
		var canvasStruct struct {
			Nodes []importer.CanvasNode `json:"nodes"`
			Edges []importer.CanvasEdge `json:"edges"`
		}
		_ = json.Unmarshal(canvasBytes, &canvasStruct)
		
		if len(payload.Files) == 0 {
			compiledFiles, err := importer.CompileCanvas(canvasStruct.Nodes, canvasStruct.Edges)
			if err == nil {
				for _, f := range compiledFiles {
					payload.Files = append(payload.Files, runner.FileItem{
						Path:    f.Path,
						Content: f.Content,
					})
				}
			}
		}
	}

	if len(payload.Files) == 0 && canvasNodesJSON != "" {
		var nodes []importer.CanvasNode
		var edges []importer.CanvasEdge
		_ = json.Unmarshal([]byte(canvasNodesJSON), &nodes)
		_ = json.Unmarshal([]byte(canvasEdgesJSON), &edges)

		compiledFiles, err := importer.CompileCanvas(nodes, edges)
		if err == nil {
			for _, f := range compiledFiles {
				payload.Files = append(payload.Files, runner.FileItem{
					Path:    f.Path,
					Content: f.Content,
				})
			}
		}
	}

	// Resolve credentials/env before committing to a run: a live cloud deploy
	// (not a LocalStack sandbox run) with no SSH credential configured for
	// this project is rejected here, cleanly, rather than being accepted and
	// failing several seconds later deep inside a Terraform provider error
	// about an invalid key format — see extractSecretsAndEnvironment.
	extraEnv, secretsToMask, sshCredentialAvailable := extractSecretsAndEnvironment(projectID, canvasStr)
	if !runner.IsSandbox(canvasStr) && !sshCredentialAvailable {
		http.Error(w, "This live deploy has no SSH credential configured. Add one under Project Credentials before deploying to a real cloud target — the shared sandbox key cannot be used for real infrastructure.", http.StatusBadRequest)
		return
	}
	// A project's most-recently-registered paired agent being PENDING (pairing
	// never finished) or DISCONNECTED (was ACTIVE, its tunnel died — see
	// obsidian_memory/08.4's Phase 2 heartbeat item) must not be allowed to
	// silently fall through to the normal Docker-sandbox/live path:
	// RunPipeline's local_agent branch is project-wide and automatic whenever
	// resolvePairedAgent finds an ACTIVE row, so once status leaves ACTIVE, the
	// very next deploy would otherwise route to Ansible targets the user never
	// intended. A REVOKED latest agent is deliberately NOT blocked here — that
	// status means the user intentionally turned off the local-agent
	// integration for this project, so it correctly falls back to normal
	// sandbox/live behavior exactly like "never paired."
	if latestStatus, ok := latestPairedAgentStatus(projectID); ok && (latestStatus == "PENDING" || latestStatus == "DISCONNECTED") {
		http.Error(w, "This project's local Sandbox Agent is not connected (status: "+latestStatus+"). Run `whiparc sandbox up` (or check `whiparc sandbox status`) before deploying, or revoke the paired agent under Project Credentials to deploy without it.", http.StatusBadRequest)
		return
	}
	agentCtx := resolvePairedAgent(projectID)
	// extractSecretsAndEnvironment's sandbox/id_rsa.pub fallback has nothing to read on a
	// hosted-only VM, which leaves bundleGenerator.ts's invalid placeholder key in play and
	// fails aws_key_pair's ImportKeyPair. A paired agent already carries a real key (the same
	// one Ansible uses for this run), so derive the public half from it.
	if agentCtx != nil && runner.IsSandbox(canvasStr) && !hasEnvVar(extraEnv, "TF_VAR_aws_ssh_pub_key") {
		if pubKeyStr, err := publicKeyFromPrivatePEM(agentCtx.PrivateKeyPEM); err == nil {
			extraEnv = append(extraEnv,
				"TF_VAR_aws_ssh_pub_key="+pubKeyStr,
				"TF_VAR_gcp_ssh_pub_key="+pubKeyStr,
				"TF_VAR_azure_ssh_pub_key="+pubKeyStr,
			)
		} else {
			log.Printf("[SANDBOX AGENT] Could not derive SSH public key from paired agent key for project %s: %v", projectID, err)
		}
	}

	// Phase 3's default flip (obsidian_memory/08.4): a FREE-plan project with
	// no ACTIVE paired agent would otherwise silently fall through to the
	// cost-bearing hosted sandbox exactly like it always has — gate that
	// specific case once SANDBOX_AGENT_DEFAULT_CUTOFF makes it apply to this
	// user. Deliberately scoped to deploy only, not destroy: a user who
	// already has hosted-sandbox resources up must always be able to tear
	// them down, cutoff or not.
	if runner.IsSandbox(canvasStr) && agentCtx == nil && sandboxDeployGatedForFreeTier(user.ID, user.Plan) {
		http.Error(w, "Free-tier sandbox deploys now run through your own machine via the local Sandbox Agent. Run `whiparc sandbox up` to pair one for this project, or upgrade to Pro for a hosted sandbox. See /docs for setup.", http.StatusBadRequest)
		return
	}

	runID := generateUUID()
	target := deriveRunTarget(canvasStr)

	// Insert into DB as PENDING
	insertQuery := "INSERT INTO pipeline_runs (id, project_id, user_id, status, logs, canvas, run_type, target, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', '', ?, 'apply', ?, datetime('now'), datetime('now'))"
	_, err = db.Exec(insertQuery, runID, projectID, user.ID, canvasStr, nullIfEmpty(target))
	if err != nil {
		log.Printf("[DB] Error inserting new run %s: %v\n", runID, err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Initialize tracker
	tracker := &RunTracker{
		clients:      make(map[*websocket.Conn]bool),
		status:       "PENDING",
		nodeStatuses: make(map[string]string),
	}
	trackersMutex.Lock()
	trackers[runID] = tracker
	trackersMutex.Unlock()

	// Respond to client
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"runId":  runID,
		"status": "PENDING",
	})

	// Run pipeline asynchronously
	go func() {
		// Set status to RUNNING
		_, _ = db.Exec("UPDATE pipeline_runs SET status = 'RUNNING', updated_at = datetime('now') WHERE id = ?", runID)
		tracker.Lock()
		tracker.status = "RUNNING"
		tracker.Unlock()
		broadcastToTracker(runID, "status_change", "RUNNING")

		logChan := make(chan string, 100)

		// Goroutine to broadcast log stream from channel to WS clients
		go func() {
			for msg := range logChan {
				tracker.Lock()
				tracker.logs += msg
				tracker.Unlock()
				broadcastToTracker(runID, "log", msg)
			}
		}()

		// Start executing runner
		runner.RunPipeline(runID, canvasStr, payload.Files, "deploy", payload.AutoDestroy, extraEnv, secretsToMask, agentCtx, logChan, func(nodeId, status string) {
			broadcastNodeStatus(runID, nodeId, status)
		}, func(status string) {
			broadcastToTracker(runID, "status_change", status)
		}, func(finalStatus string, logs string) {
			tracker.Lock()
			finalLogs := truncateLogs(tracker.logs)
			tracker.Unlock()

			// Complete execution: commit to DB
			_, err = db.Exec("UPDATE pipeline_runs SET status = ?, logs = ?, updated_at = datetime('now') WHERE id = ?", finalStatus, finalLogs, runID)
			if err != nil {
				log.Printf("[DB] Error updating run %s: %v\n", runID, err)
			}

			if finalStatus == "SUCCESS" {
				insertActivityEvent(projectID, user.ID, "deploy.succeeded", map[string]interface{}{"target": target})
			} else if finalStatus == "FAILED" {
				insertActivityEvent(projectID, user.ID, "deploy.failed", map[string]interface{}{"target": target})
			}

			// Broadcast status change
			tracker.Lock()
			tracker.status = finalStatus
			tracker.Unlock()
			broadcastToTracker(runID, "status_change", finalStatus)

			// Clean up tracker after short delay to let WS clients finish reading
			time.AfterFunc(2*time.Second, func() {
				trackersMutex.Lock()
				t, exists := trackers[runID]
				if exists {
					t.Lock()
					for client := range t.clients {
						_ = client.Close()
					}
					t.Unlock()
					delete(trackers, runID)
				}
				trackersMutex.Unlock()
			})

			log.Printf("[RUNNER] Pipeline run %s completed with status: %s\n", runID, finalStatus)
		})
	}()
}

// POST /api/projects/{id}/plan
// A real `terraform plan` dry run (product-memory 08.5 item A9) — not the
// workspace's pre-existing "Plan" button, which was actually just a
// view-switcher to the compiled-output tab (renamed to "Preview" alongside
// this shipping). Deliberately skips every pre-flight check that only
// exists for handleDeploy's Ansible/local_agent path: no SSH-credential
// requirement (plan never runs Ansible), no paired-agent
// PENDING/DISCONNECTED gate (same reason), and no FREE-tier sandbox gating
// (a plan is cheap/read-only, not the cost-bearing hosted sandbox that gate
// exists to protect). See runner.RunPipeline's "ACTION: PLAN" branch for
// what actually runs.
func handlePlan(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, _ := GetUserFromContext(r)

	var payload DeployPayload
	err := json.NewDecoder(r.Body).Decode(&payload)
	if err != nil {
		http.Error(w, "Invalid request payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	var canvasStr string
	var canvasNodesJSON, canvasEdgesJSON string

	if payload.Canvas == nil {
		err = db.QueryRow("SELECT nodes_json, edges_json FROM canvas_states WHERE project_id = ?", projectID).Scan(&canvasNodesJSON, &canvasEdgesJSON)
		if err == sql.ErrNoRows {
			canvasNodesJSON = "[]"
			canvasEdgesJSON = "[]"
		} else if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		canvasStr = fmt.Sprintf(`{"nodes":%s,"edges":%s}`, canvasNodesJSON, canvasEdgesJSON)
	} else {
		canvasBytes, err := json.Marshal(payload.Canvas)
		if err != nil {
			http.Error(w, "Invalid canvas format", http.StatusBadRequest)
			return
		}
		canvasStr = string(canvasBytes)

		var canvasStruct struct {
			Nodes []importer.CanvasNode `json:"nodes"`
			Edges []importer.CanvasEdge `json:"edges"`
		}
		_ = json.Unmarshal(canvasBytes, &canvasStruct)

		if len(payload.Files) == 0 {
			compiledFiles, err := importer.CompileCanvas(canvasStruct.Nodes, canvasStruct.Edges)
			if err == nil {
				for _, f := range compiledFiles {
					payload.Files = append(payload.Files, runner.FileItem{
						Path:    f.Path,
						Content: f.Content,
					})
				}
			}
		}
	}

	if len(payload.Files) == 0 && canvasNodesJSON != "" {
		var nodes []importer.CanvasNode
		var edges []importer.CanvasEdge
		_ = json.Unmarshal([]byte(canvasNodesJSON), &nodes)
		_ = json.Unmarshal([]byte(canvasEdgesJSON), &edges)

		compiledFiles, err := importer.CompileCanvas(nodes, edges)
		if err == nil {
			for _, f := range compiledFiles {
				payload.Files = append(payload.Files, runner.FileItem{
					Path:    f.Path,
					Content: f.Content,
				})
			}
		}
	}

	// Still resolved (not skipped) so a live-AWS/GCP plan can actually reach
	// the real provider with real credentials, exactly like deploy — just
	// without deploy's SSH-credential requirement, since plan never reaches
	// the Ansible phase that needs one.
	extraEnv, secretsToMask, _ := extractSecretsAndEnvironment(projectID, canvasStr)

	runID := generateUUID()
	target := deriveRunTarget(canvasStr)

	insertQuery := "INSERT INTO pipeline_runs (id, project_id, user_id, status, logs, canvas, run_type, target, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', '', ?, 'plan', ?, datetime('now'), datetime('now'))"
	_, err = db.Exec(insertQuery, runID, projectID, user.ID, canvasStr, nullIfEmpty(target))
	if err != nil {
		log.Printf("[DB] Error inserting new plan run %s: %v\n", runID, err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	tracker := &RunTracker{
		clients:      make(map[*websocket.Conn]bool),
		status:       "PENDING",
		nodeStatuses: make(map[string]string),
	}
	trackersMutex.Lock()
	trackers[runID] = tracker
	trackersMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"runId":  runID,
		"status": "PENDING",
	})

	go func() {
		_, _ = db.Exec("UPDATE pipeline_runs SET status = 'RUNNING', updated_at = datetime('now') WHERE id = ?", runID)
		tracker.Lock()
		tracker.status = "RUNNING"
		tracker.Unlock()
		broadcastToTracker(runID, "status_change", "RUNNING")

		logChan := make(chan string, 100)
		go func() {
			for msg := range logChan {
				tracker.Lock()
				tracker.logs += msg
				tracker.Unlock()
				broadcastToTracker(runID, "log", msg)
			}
		}()

		runner.RunPipeline(runID, canvasStr, payload.Files, "plan", false, extraEnv, secretsToMask, nil, logChan, func(nodeId, status string) {
			broadcastNodeStatus(runID, nodeId, status)
		}, func(status string) {
			broadcastToTracker(runID, "status_change", status)
		}, func(finalStatus string, logs string) {
			tracker.Lock()
			finalLogs := truncateLogs(tracker.logs)
			tracker.Unlock()

			_, err = db.Exec("UPDATE pipeline_runs SET status = ?, logs = ?, updated_at = datetime('now') WHERE id = ?", finalStatus, finalLogs, runID)
			if err != nil {
				log.Printf("[DB] Error updating plan run %s: %v\n", runID, err)
			}

			if finalStatus == "SUCCESS" {
				insertActivityEvent(projectID, user.ID, "plan.succeeded", map[string]interface{}{"target": target})
			} else if finalStatus == "FAILED" {
				insertActivityEvent(projectID, user.ID, "plan.failed", map[string]interface{}{"target": target})
			}

			tracker.Lock()
			tracker.status = finalStatus
			tracker.Unlock()
			broadcastToTracker(runID, "status_change", finalStatus)

			time.AfterFunc(2*time.Second, func() {
				trackersMutex.Lock()
				t, exists := trackers[runID]
				if exists {
					t.Lock()
					for client := range t.clients {
						_ = client.Close()
					}
					t.Unlock()
					delete(trackers, runID)
				}
				trackersMutex.Unlock()
			})

			log.Printf("[RUNNER] Plan run %s completed with status: %s\n", runID, finalStatus)
		})
	}()
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing run ID", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade failed for %s: %v\n", id, err)
		return
	}

	log.Printf("[WS] Client connected for run %s\n", id)

	trackersMutex.Lock()
	tracker, active := trackers[id]
	trackersMutex.Unlock()

	if active {
		tracker.Lock()
		// Register client
		tracker.clients[conn] = true
		// Write existing logs to catch up
		if tracker.logs != "" {
			_ = conn.WriteJSON(map[string]string{
				"type":    "log",
				"message": tracker.logs,
			})
		}
		// Send current status
		_ = conn.WriteJSON(map[string]string{
			"type":   "status_change",
			"status": tracker.status,
		})
		// Replay all node statuses so late-connecting clients get current per-node state
		for nodeId, nodeStatus := range tracker.nodeStatuses {
			_ = conn.WriteJSON(map[string]string{
				"type":   "node_status",
				"nodeId": nodeId,
				"status": nodeStatus,
			})
		}
		tracker.Unlock()

		// Read loop to detect disconnects
		go func() {
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					tracker.Lock()
					delete(tracker.clients, conn)
					tracker.Unlock()
					_ = conn.Close()
					log.Printf("[WS] Client disconnected from run %s\n", id)
					break
				}
			}
		}()
	} else {
		// Read historical log from database
		var status, logs string
		err := db.QueryRow("SELECT status, logs FROM pipeline_runs WHERE id = ?", id).Scan(&status, &logs)
		if err == nil {
			// Send historical logs and close connection immediately
			_ = conn.WriteJSON(map[string]string{
				"type":    "log",
				"message": logs,
			})
			_ = conn.WriteJSON(map[string]string{
				"type":   "status_change",
				"status": status,
			})
		}
		_ = conn.Close()
	}
}

func broadcastNodeStatus(runID, nodeId, status string) {
	trackersMutex.Lock()
	tracker, exists := trackers[runID]
	trackersMutex.Unlock()
	if !exists {
		return
	}
	tracker.Lock()
	defer tracker.Unlock()
	tracker.nodeStatuses[nodeId] = status // persist so late-connecting WS clients can catch up
	payload := map[string]string{
		"type":   "node_status",
		"nodeId": nodeId,
		"status": status,
	}
	for client := range tracker.clients {
		if err := client.WriteJSON(payload); err != nil {
			log.Printf("[WS] Node status broadcast error: %v\n", err)
			_ = client.Close()
			delete(tracker.clients, client)
		}
	}
}

func broadcastToTracker(runID string, msgType string, content string) {
	trackersMutex.Lock()
	tracker, exists := trackers[runID]
	trackersMutex.Unlock()

	if !exists {
		return
	}

	tracker.Lock()
	defer tracker.Unlock()

	payload := map[string]string{
		"type": msgType,
	}
	if msgType == "status_change" {
		payload["status"] = content
	} else {
		payload["message"] = content
	}

	for client := range tracker.clients {
		err := client.WriteJSON(payload)
		if err != nil {
			log.Printf("[WS] Broadcast error: %v\n", err)
			_ = client.Close()
			delete(tracker.clients, client)
		}
	}
}

func generateUUID() string {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return "run-random-id"
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func handleDestroy(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, _ := GetUserFromContext(r)

	var payload struct {
		Canvas interface{} `json:"canvas"`
	}
	err := json.NewDecoder(r.Body).Decode(&payload)
	if err != nil {
		http.Error(w, "Invalid request payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	var canvasStr string
	if payload.Canvas == nil {
		var canvasNodesJSON, canvasEdgesJSON string
		err = db.QueryRow("SELECT nodes_json, edges_json FROM canvas_states WHERE project_id = ?", projectID).Scan(&canvasNodesJSON, &canvasEdgesJSON)
		if err == sql.ErrNoRows {
			canvasNodesJSON = "[]"
			canvasEdgesJSON = "[]"
		} else if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		canvasStr = fmt.Sprintf(`{"nodes":%s,"edges":%s}`, canvasNodesJSON, canvasEdgesJSON)
	} else {
		canvasBytes, err := json.Marshal(payload.Canvas)
		if err != nil {
			http.Error(w, "Invalid canvas format", http.StatusBadRequest)
			return
		}
		canvasStr = string(canvasBytes)
	}

	// Same pre-flight rejection as handleDeploy, and for the same reason:
	// RunPipeline's local_agent branch is automatic whenever resolvePairedAgent
	// finds an ACTIVE row, so a PENDING/DISCONNECTED latest paired agent must
	// not be allowed to silently fall through to the Docker-sandbox/live path
	// here either — see obsidian_memory/08.4's Phase 2 heartbeat item.
	if latestStatus, ok := latestPairedAgentStatus(projectID); ok && (latestStatus == "PENDING" || latestStatus == "DISCONNECTED") {
		http.Error(w, "This project's local Sandbox Agent is not connected (status: "+latestStatus+"). Run `whiparc sandbox up` (or check `whiparc sandbox status`) before destroying, or revoke the paired agent under Project Credentials to proceed without it.", http.StatusBadRequest)
		return
	}

	runID := generateUUID()
	target := deriveRunTarget(canvasStr)

	// Insert into DB as PENDING
	insertQuery := "INSERT INTO pipeline_runs (id, project_id, user_id, status, logs, canvas, run_type, target, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', '', ?, 'destroy', ?, datetime('now'), datetime('now'))"
	_, err = db.Exec(insertQuery, runID, projectID, user.ID, canvasStr, nullIfEmpty(target))
	if err != nil {
		log.Printf("[DB] Error inserting destroy run %s: %v\n", runID, err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Initialize tracker
	tracker := &RunTracker{
		clients:      make(map[*websocket.Conn]bool),
		status:       "PENDING",
		nodeStatuses: make(map[string]string),
	}
	trackersMutex.Lock()
	trackers[runID] = tracker
	trackersMutex.Unlock()

	// Respond to client
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"runId":  runID,
		"status": "PENDING",
	})

	// Run destroy pipeline asynchronously
	go func() {
		_, _ = db.Exec("UPDATE pipeline_runs SET status = 'RUNNING', updated_at = datetime('now') WHERE id = ?", runID)
		tracker.Lock()
		tracker.status = "RUNNING"
		tracker.Unlock()
		broadcastToTracker(runID, "status_change", "RUNNING")

		logChan := make(chan string, 100)

		go func() {
			for msg := range logChan {
				tracker.Lock()
				tracker.logs += msg
				tracker.Unlock()
				broadcastToTracker(runID, "log", msg)
			}
		}()

		extraEnv, secretsToMask, _ := extractSecretsAndEnvironment(projectID, canvasStr)
		agentCtx := resolvePairedAgent(projectID)

		runner.RunPipeline(runID, canvasStr, nil, "destroy", false, extraEnv, secretsToMask, agentCtx, logChan, func(nodeId, status string) {
			broadcastNodeStatus(runID, nodeId, status)
		}, nil, func(finalStatus string, logs string) {
			tracker.Lock()
			finalLogs := truncateLogs(tracker.logs)
			tracker.Unlock()

			_, err = db.Exec("UPDATE pipeline_runs SET status = ?, logs = ?, updated_at = datetime('now') WHERE id = ?", finalStatus, finalLogs, runID)
			if err != nil {
				log.Printf("[DB] Error updating destroy run %s: %v\n", runID, err)
			}

			if finalStatus == "SUCCESS" {
				insertActivityEvent(projectID, user.ID, "destroy.succeeded", map[string]interface{}{"target": target})
			} else if finalStatus == "FAILED" {
				insertActivityEvent(projectID, user.ID, "destroy.failed", map[string]interface{}{"target": target})
			}

			tracker.Lock()
			tracker.status = finalStatus
			tracker.Unlock()
			broadcastToTracker(runID, "status_change", finalStatus)

			time.AfterFunc(2*time.Second, func() {
				trackersMutex.Lock()
				t, exists := trackers[runID]
				if exists {
					t.Lock()
					for client := range t.clients {
						_ = client.Close()
					}
					t.Unlock()
					delete(trackers, runID)
				}
				trackersMutex.Unlock()
			})
		})
	}()
}

// --- AUTHENTICATION & COLLABORATION STACK IMPLEMENTATION ---

// jwtSecret signs every session token this API issues — anyone who knows it
// can forge a valid token for any user. It used to be hardcoded here with no
// override, which is harmless on a laptop but means a public deployment that
// never sets JWT_SECRET is signing every user's session with a secret that's
// sitting in the public source tree.
var jwtSecret []byte

func init() {
	keyStr := os.Getenv("JWT_SECRET")
	if keyStr == "" {
		log.Println("[AUTH] WARNING: JWT_SECRET is not set — falling back to the built-in development key. Set a real random secret before exposing this API publicly.")
		keyStr = "whiparc_workspace_orchestration_secret_key_98765!"
	}
	jwtSecret = []byte(keyStr)
}

type TokenHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

type TokenClaims struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Plan          string `json:"plan"`
	EmailVerified bool   `json:"email_verified"`
	Exp           int64  `json:"exp"`
}

func generateRandomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func GenerateToken(userID, email, name, plan string, emailVerified bool) (string, error) {
	header := TokenHeader{Alg: "HS256", Typ: "JWT"}
	headerJSON, _ := json.Marshal(header)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)

	claims := TokenClaims{
		ID:            userID,
		Email:         email,
		Name:          name,
		Plan:          plan,
		EmailVerified: emailVerified,
		Exp:           time.Now().Add(24 * time.Hour).Unix(),
	}
	claimsJSON, _ := json.Marshal(claims)
	claimsB64 := base64.RawURLEncoding.EncodeToString(claimsJSON)

	unsignedToken := headerB64 + "." + claimsB64

	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(unsignedToken))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return unsignedToken + "." + signature, nil
}

func VerifyToken(tokenStr string) (*TokenClaims, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	unsignedToken := parts[0] + "." + parts[1]
	signatureB64 := parts[2]

	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(unsignedToken))
	expectedSignature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	if signatureB64 != expectedSignature {
		return nil, fmt.Errorf("signature verification failed")
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("failed to decode claims: %v", err)
	}

	var claims TokenClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, fmt.Errorf("failed to unmarshal claims: %v", err)
	}

	if time.Now().Unix() > claims.Exp {
		return nil, fmt.Errorf("token has expired")
	}

	return &claims, nil
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func handleSignup(w http.ResponseWriter, r *http.Request) {
	if !signupLimiter.Allow(ClientIP(r)) {
		http.Error(w, "Too many signup attempts. Please wait a few minutes before trying again.", http.StatusTooManyRequests)
		return
	}

	var payload struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	email := strings.TrimSpace(strings.ToLower(payload.Email))
	name := strings.TrimSpace(payload.Name)
	if email == "" || payload.Password == "" || name == "" {
		http.Error(w, "Email, password, and name are required", http.StatusBadRequest)
		return
	}

	// Validate email structure and reject disposable/burner domains
	if err := ValidateEmail(email); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	hash, err := hashPassword(payload.Password)
	if err != nil {
		http.Error(w, "Failed to secure password: "+err.Error(), http.StatusInternalServerError)
		return
	}

	userID := fmt.Sprintf("usr_%d", time.Now().UnixNano())
	verificationToken := generateRandomHex(32)
	verificationExpiresAt := time.Now().Add(24 * time.Hour)

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Transaction failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	insertQuery := "INSERT INTO users (id, email, password_hash, name, email_verified, verification_token, verification_expires_at) VALUES (?, ?, ?, ?, FALSE, ?, ?)"
	_, err = tx.Exec(insertQuery, userID, email, hash, name, verificationToken, verificationExpiresAt)
	if err != nil {
		// SQLite reports "UNIQUE constraint failed", Postgres reports
		// "duplicate key value violates unique constraint" (lowercase) —
		// match case-insensitively on "unique" so this branch fires on both
		// backends instead of leaking the raw Postgres error to the client.
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			http.Error(w, "Email already exists", http.StatusConflict)
		} else {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		}
		return
	}

	if err := createPersonalTeam(tx, userID, name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to finalize registration: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Dispatch verification email in background (Console / Resend / SMTP)
	verificationLink := fmt.Sprintf("%s/verify-email?token=%s", oauthFrontendBase(), verificationToken)
	go func() {
		if err := emailSender.SendVerificationEmail(email, name, verificationLink); err != nil {
			log.Printf("[EMAIL] Failed to send verification email to %s: %v\n", email, err)
		}
	}()

	token, err := GenerateToken(userID, email, name, "FREE", false)
	if err != nil {
		http.Error(w, "Failed to sign token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":             userID,
			"email":          email,
			"name":           name,
			"plan":           "FREE",
			"email_verified": false,
		},
	})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if !loginLimiter.Allow(ClientIP(r)) {
		http.Error(w, "Too many login attempts. Please wait a few minutes before trying again.", http.StatusTooManyRequests)
		return
	}

	var payload struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	email := strings.TrimSpace(strings.ToLower(payload.Email))
	if email == "" || payload.Password == "" {
		http.Error(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	var userID, name, plan string
	var emailVerified bool
	var hash sql.NullString
	err := db.QueryRow("SELECT id, name, password_hash, plan, email_verified FROM users WHERE email = ?", email).Scan(&userID, &name, &hash, &plan, &emailVerified)
	if err == sql.ErrNoRows {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Challenge #8: OAuth-only accounts have no password_hash at all — reject
	// cleanly instead of crashing or comparing against an empty/invalid hash.
	if !hash.Valid {
		http.Error(w, "This account signs in with Google or GitHub — use the social sign-in button instead", http.StatusUnauthorized)
		return
	}

	if !checkPasswordHash(payload.Password, hash.String) {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}

	token, err := GenerateToken(userID, email, name, plan, emailVerified)
	if err != nil {
		http.Error(w, "Failed to sign token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":             userID,
			"email":          email,
			"name":           name,
			"plan":           plan,
			"email_verified": emailVerified,
		},
	})
}

// POST or GET /api/auth/verify-email
func handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	var tokenStr string
	if r.Method == http.MethodPost {
		var payload struct {
			Token string `json:"token"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		tokenStr = strings.TrimSpace(payload.Token)
	}
	if tokenStr == "" {
		tokenStr = strings.TrimSpace(r.URL.Query().Get("token"))
	}

	if tokenStr == "" {
		http.Error(w, "Verification token is required", http.StatusBadRequest)
		return
	}

	var userID, email, name, plan string
	var expiresAt time.Time
	err := db.QueryRow("SELECT id, email, name, plan, verification_expires_at FROM users WHERE verification_token = ?", tokenStr).Scan(&userID, &email, &name, &plan, &expiresAt)
	if err == sql.ErrNoRows {
		http.Error(w, "Invalid or already used verification link", http.StatusBadRequest)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if time.Now().After(expiresAt) {
		http.Error(w, "Verification link has expired. Please log in and request a new one.", http.StatusBadRequest)
		return
	}

	_, err = db.Exec("UPDATE users SET email_verified = TRUE, verification_token = NULL, verification_expires_at = NULL WHERE id = ?", userID)
	if err != nil {
		http.Error(w, "Failed to update verification status: "+err.Error(), http.StatusInternalServerError)
		return
	}

	newToken, err := GenerateToken(userID, email, name, plan, true)
	if err != nil {
		http.Error(w, "Failed to sign updated session token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Email verified successfully",
		"token":   newToken,
		"user": map[string]interface{}{
			"id":             userID,
			"email":          email,
			"name":           name,
			"plan":           plan,
			"email_verified": true,
		},
	})
}

// POST /api/auth/resend-verification
func handleResendVerification(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if !resendLimiter.Allow(user.ID) {
		http.Error(w, "Too many resend attempts. Please wait a few minutes before trying again.", http.StatusTooManyRequests)
		return
	}

	var emailVerified bool
	var email, name string
	err := db.QueryRow("SELECT email_verified, email, name FROM users WHERE id = ?", user.ID).Scan(&emailVerified, &email, &name)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	if emailVerified {
		http.Error(w, "Email is already verified", http.StatusBadRequest)
		return
	}

	newToken := generateRandomHex(32)
	newExpiresAt := time.Now().Add(24 * time.Hour)

	_, err = db.Exec("UPDATE users SET verification_token = ?, verification_expires_at = ? WHERE id = ?", newToken, newExpiresAt, user.ID)
	if err != nil {
		http.Error(w, "Failed to create verification token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	verificationLink := fmt.Sprintf("%s/verify-email?token=%s", oauthFrontendBase(), newToken)
	go func() {
		if err := emailSender.SendVerificationEmail(email, name, verificationLink); err != nil {
			log.Printf("[EMAIL] Failed to resend verification email to %s: %v\n", email, err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Verification link sent successfully",
	})
}

// --- WebSocket Workspace Sync Server ---

type SyncMessage struct {
	Type       string          `json:"type"` // "cursor", "change", "edit", "join", "leave", "init"
	ProjectID  string          `json:"projectId,omitempty"`
	SenderID   string          `json:"senderId,omitempty"`
	SenderName string          `json:"senderName,omitempty"`
	Color      string          `json:"color,omitempty"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}

type SyncClient struct {
	conn     *websocket.Conn
	roomID   string
	userID   string
	userName string
	color    string
}

type WorkspaceRoom struct {
	sync.RWMutex
	clients map[*websocket.Conn]*SyncClient
}

var (
	rooms      = make(map[string]*WorkspaceRoom)
	roomsMutex sync.Mutex
)

var tailwindColors = []string{
	"#F43F5E", // rose-500
	"#EC4899", // pink-500
	"#D946EF", // fuchsia-500
	"#A855F7", // purple-500
	"#6366F1", // indigo-500
	"#3B82F6", // blue-500
	"#0EA5E9", // sky-500
	"#06B6D4", // cyan-500
	"#14B8A6", // teal-500
	"#10B981", // emerald-500
	"#22C55E", // green-500
	"#84CC16", // lime-500
	"#EAB308", // yellow-500
	"#F97316", // orange-500
}

func getRandomColor(seed string) string {
	sum := 0
	for _, char := range seed {
		sum += int(char)
	}
	return tailwindColors[sum%len(tailwindColors)]
}

func handleWorkspaceWebSocketSync(w http.ResponseWriter, r *http.Request) {
	// Parse projectId from URL path wildcards
	projectId := r.PathValue("projectId")
	if projectId == "" {
		http.Error(w, "ProjectId is required", http.StatusBadRequest)
		return
	}

	// Authenticate via token query parameter
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		http.Error(w, "Authorization token is required", http.StatusUnauthorized)
		return
	}

	claims, err := VerifyToken(tokenStr)
	if err != nil {
		http.Error(w, "Unauthorized token: "+err.Error(), http.StatusUnauthorized)
		return
	}

	// Upgrade the connection
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[SYNC] Failed to upgrade WebSocket connection: %v\n", err)
		return
	}
	defer conn.Close()

	// Register the client in the room
	roomsMutex.Lock()
	room, exists := rooms[projectId]
	if !exists {
		room = &WorkspaceRoom{
			clients: make(map[*websocket.Conn]*SyncClient),
		}
		rooms[projectId] = room
	}
	roomsMutex.Unlock()

	clientColor := getRandomColor(claims.ID)
	client := &SyncClient{
		conn:     conn,
		roomID:   projectId,
		userID:   claims.ID,
		userName: claims.Name,
		color:    clientColor,
	}

	room.Lock()
	room.clients[conn] = client
	
	// Create active users user list to send back as an initialization
	activeUsersList := make([]map[string]string, 0)
	for _, c := range room.clients {
		activeUsersList = append(activeUsersList, map[string]string{
			"id":   c.userID,
			"name": c.userName,
			"color": c.color,
		})
	}
	room.Unlock()

	log.Printf("[SYNC] User %s joined workspace %s\n", claims.Name, projectId)

	// Send initial list of active users to the new client
	initPayload, _ := json.Marshal(activeUsersList)
	_ = conn.WriteJSON(SyncMessage{
		Type:       "init",
		ProjectID:  projectId,
		SenderID:   client.userID,
		SenderName: client.userName,
		Color:      client.color,
		Payload:    initPayload,
	})

	// Broadcast JOIN to all other clients in the room
	joinMsg := SyncMessage{
		Type:       "join",
		ProjectID:  projectId,
		SenderID:   client.userID,
		SenderName: client.userName,
		Color:      client.color,
		Payload:    initPayload, // send current list of members
	}
	broadcastToRoom(projectId, joinMsg, conn)

	// Read loop
	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg SyncMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		// Fill system metadata details
		msg.SenderID = client.userID
		msg.SenderName = client.userName
		msg.Color = client.color
		msg.ProjectID = projectId

		// Relay message to all other clients in the room
		broadcastToRoom(projectId, msg, conn)
	}

	// Unregister client
	room.Lock()
	delete(room.clients, conn)
	
	// Re-compile active users user list post-exit
	remainingUsers := make([]map[string]string, 0)
	for _, c := range room.clients {
		remainingUsers = append(remainingUsers, map[string]string{
			"id":   c.userID,
			"name": c.userName,
			"color": c.color,
		})
	}
	room.Unlock()

	log.Printf("[SYNC] User %s left workspace %s\n", claims.Name, projectId)

	// Broadcast LEAVE to all other clients in the room
	leavePayload, _ := json.Marshal(remainingUsers)
	leaveMsg := SyncMessage{
		Type:       "leave",
		ProjectID:  projectId,
		SenderID:   client.userID,
		SenderName: client.userName,
		Payload:    leavePayload,
	}
	broadcastToRoom(projectId, leaveMsg, nil)
}

func broadcastToRoom(roomID string, msg SyncMessage, senderConn *websocket.Conn) {
	roomsMutex.Lock()
	room, exists := rooms[roomID]
	roomsMutex.Unlock()

	if !exists {
		return
	}

	room.RLock()
	defer room.RUnlock()

	for conn := range room.clients {
		if conn == senderConn {
			// Do not loopback message to the sender
			continue
		}
		_ = conn.WriteJSON(msg)
	}
}

// POST /api/auth/upgrade
func handleUpgradePlan(w http.ResponseWriter, r *http.Request) {
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		Plan string `json:"plan"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	plan := strings.ToUpper(payload.Plan)
	if plan != "PRO" && plan != "ENTERPRISE" && plan != "FREE" {
		http.Error(w, "Invalid plan selection", http.StatusBadRequest)
		return
	}

	_, err := db.Exec("UPDATE users SET plan = ? WHERE id = ?", plan, user.ID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	newToken, err := GenerateToken(user.ID, user.Email, user.Name, plan, user.EmailVerified)
	if err != nil {
		http.Error(w, "Failed to sign token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": newToken,
		"user": map[string]interface{}{
			"id":             user.ID,
			"email":          user.Email,
			"name":           user.Name,
			"plan":           plan,
			"email_verified": user.EmailVerified,
		},
	})
}

// extractSecretsAndEnvironment returns the runner env vars, the secret
// values to redact from logs, and whether a real SSH public key ended up
// available (either from a configured project credential, or the sandbox
// fallback for a LocalStack run) — the caller uses that third value to
// reject a live cloud deploy upfront, before ever starting Terraform, rather
// than letting it fail deep inside a confusing provider error. See the
// pre-flight check in handleDeploy.
func extractSecretsAndEnvironment(projectID string, canvasStr string) ([]string, []string, bool) {
	var extraEnv []string
	var secretsToMask []string
	sshPubKeyInjected := false

	loadCredential := func(credID string) {
		var provider, name string
		var encryptedData, nonce, authTag []byte
		err := db.QueryRow("SELECT provider, name, encrypted_data, nonce, auth_tag FROM cloud_credentials WHERE id = ? AND project_id = ?", credID, projectID).Scan(
			&provider, &name, &encryptedData, &nonce, &authTag)
		if err != nil {
			log.Printf("[VAULT] Warning: Failed to load credential %s: %v\n", credID, err)
			return
		}

		decrypted, err := vault.Decrypt(encryptedData, nonce, authTag)
		if err != nil {
			log.Printf("[VAULT] Error: Failed to decrypt credential %s: %v\n", credID, err)
			return
		}

		if provider == "AWS" {
			var creds struct {
				AccessKeyID     string `json:"accessKeyId"`
				SecretAccessKey string `json:"secretAccessKey"`
				Region          string `json:"region"`
			}
			if err := json.Unmarshal(decrypted, &creds); err == nil {
				extraEnv = append(extraEnv, "AWS_ACCESS_KEY_ID="+creds.AccessKeyID)
				extraEnv = append(extraEnv, "AWS_SECRET_ACCESS_KEY="+creds.SecretAccessKey)
				if creds.Region != "" {
					extraEnv = append(extraEnv, "AWS_DEFAULT_REGION="+creds.Region)
				}
				secretsToMask = append(secretsToMask, creds.AccessKeyID, creds.SecretAccessKey)
			}
		} else if provider == "GCP" {
			extraEnv = append(extraEnv, "GOOGLE_CREDENTIALS_CONTENT="+string(decrypted))
			var creds struct {
				PrivateKey string `json:"private_key"`
			}
			if err := json.Unmarshal(decrypted, &creds); err == nil && creds.PrivateKey != "" {
				secretsToMask = append(secretsToMask, creds.PrivateKey)
			}
		} else if provider == "SSH" {
			keyContent := string(decrypted)
			sshUser := "ubuntu"

			var sshPayload struct {
				PrivateKey string `json:"private_key"`
				SSHUser    string `json:"ssh_user"`
			}
			if err := json.Unmarshal(decrypted, &sshPayload); err == nil && sshPayload.PrivateKey != "" {
				keyContent = sshPayload.PrivateKey
				if sshPayload.SSHUser != "" {
					sshUser = sshPayload.SSHUser
				}
			}

			extraEnv = append(extraEnv, "ANSIBLE_SSH_KEY_CONTENT="+keyContent)
			extraEnv = append(extraEnv, "ANSIBLE_SSH_USER="+sshUser)
			secretsToMask = append(secretsToMask, keyContent)

			// Derive SSH public key to pass as TF_VAR variables for GCP / Azure instances
			if parsedKey, err := ssh.ParseRawPrivateKey([]byte(keyContent)); err == nil {
				if signer, err := ssh.NewSignerFromKey(parsedKey); err == nil {
					pubKeyBytes := ssh.MarshalAuthorizedKey(signer.PublicKey())
					pubKeyStr := strings.TrimSpace(string(pubKeyBytes))
					extraEnv = append(extraEnv, "TF_VAR_aws_ssh_pub_key="+pubKeyStr)
					extraEnv = append(extraEnv, "TF_VAR_gcp_ssh_pub_key="+pubKeyStr)
					extraEnv = append(extraEnv, "TF_VAR_azure_ssh_pub_key="+pubKeyStr)
					sshPubKeyInjected = true
				}
			}
		} else if provider == "GITHUB" {
			var creds struct {
				Token string `json:"token"`
			}
			if err := json.Unmarshal(decrypted, &creds); err == nil && creds.Token != "" {
				extraEnv = append(extraEnv, "GITHUB_PAT="+creds.Token)
				secretsToMask = append(secretsToMask, creds.Token)
			}
		}
	}

	var canvasStruct struct {
		Nodes []struct {
			ID   string `json:"id"`
			Data struct {
				Parameters   map[string]interface{} `json:"parameters"`
				CredentialID string                 `json:"credentialId"`
				SshKeyID     string                 `json:"sshKeyId"`
			} `json:"data"`
		} `json:"nodes"`
	}
	_ = json.Unmarshal([]byte(canvasStr), &canvasStruct)

	for _, n := range canvasStruct.Nodes {
		if n.Data.CredentialID != "" {
			loadCredential(n.Data.CredentialID)
		}
		if n.Data.SshKeyID != "" {
			loadCredential(n.Data.SshKeyID)
		}
		if cid, ok := n.Data.Parameters["credentialId"].(string); ok && cid != "" {
			loadCredential(cid)
		}
		if cid, ok := n.Data.Parameters["credentialSource"].(string); ok && cid != "" {
			loadCredential(cid)
		}
		if cid, ok := n.Data.Parameters["sshKeyId"].(string); ok && cid != "" {
			loadCredential(cid)
		}
	}

	// No project SSH credential provided a real public key. For a LocalStack
	// sandbox run, fall back to the actual sandbox/id_rsa.pub content rather
	// than leaving the placeholder dummy key baked into bundleGenerator.ts's
	// Terraform template in place — that placeholder is not a syntactically
	// valid OpenSSH key, so it fails aws_key_pair's real-AWS ImportKeyPair
	// call with "Key is not in valid OpenSSH public key format" (LocalStack's
	// mock doesn't validate this, which is why the placeholder silently
	// "worked" there). This also keeps the injected public key consistent
	// with the private key the Ansible phase's sandbox-key fallback (below,
	// in runner.go) actually uses when no custom SSH credential is configured.
	//
	// For a real AWS/GCP/Azure deploy, this fallback must NOT apply — an SSH
	// credential is mandatory there. Silently reusing the shared sandbox
	// keypair against a real cloud resource is exactly the "shared key baked
	// into every install" risk flagged in obsidian_memory/08.4; the deploy
	// should fail clearly instead, prompting the user to configure a real
	// credential, not succeed with a key nobody but every sandbox install can
	// use to SSH in.
	if !sshPubKeyInjected && runner.IsSandbox(canvasStr) {
		if pubKeyStr, err := readSandboxPublicKey(); err == nil {
			extraEnv = append(extraEnv, "TF_VAR_aws_ssh_pub_key="+pubKeyStr)
			extraEnv = append(extraEnv, "TF_VAR_gcp_ssh_pub_key="+pubKeyStr)
			extraEnv = append(extraEnv, "TF_VAR_azure_ssh_pub_key="+pubKeyStr)
			sshPubKeyInjected = true
		} else {
			// Was silent before: the deploy would proceed straight into
			// Terraform with bundleGenerator.ts's syntactically-invalid
			// dummySshKey placeholder still in play, surfacing only as a
			// confusing "InvalidKeyPair.Format" error deep inside the
			// provider's ImportKeyPair call, with no link back to the
			// missing file. Most common cause: a hosted-only deployment
			// (docker-compose.hosted.yml) whose ./sandbox bind mount is
			// present but empty, because sandbox/id_rsa[.pub] is
			// gitignored and nothing generates it there — only the
			// local-dev `ssh-keygen ... -f sandbox/id_rsa` step (see
			// docs/DEVELOPMENT.md) or `whiparc sandbox up` do that, and
			// neither runs against a hosted-only checkout.
			log.Printf("[SANDBOX] Warning: no SSH public key available for LocalStack deploy of project %s (%v) — falling back to bundleGenerator.ts's placeholder key, which real/LocalStack EC2 key-format validation will reject", projectID, err)
		}
	}

	return extraEnv, secretsToMask, sshPubKeyInjected
}

// hasEnvVar reports whether env (KEY=VALUE entries) already sets key.
func hasEnvVar(env []string, key string) bool {
	for _, e := range env {
		if strings.HasPrefix(e, key+"=") {
			return true
		}
	}
	return false
}

// publicKeyFromPrivatePEM derives the OpenSSH authorized_keys-format public key
// from a PEM-encoded private key.
func publicKeyFromPrivatePEM(pemStr string) (string, error) {
	parsed, err := ssh.ParseRawPrivateKey([]byte(pemStr))
	if err != nil {
		return "", err
	}
	signer, err := ssh.NewSignerFromKey(parsed)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey()))), nil
}

// readSandboxPublicKey reads the real sandbox SSH public key, mirroring the
// path-resolution runner.go's Ansible-phase key fallback already uses for the
// matching private half (/app/sandbox/id_rsa under Docker, ../../sandbox/id_rsa
// when running the API natively).
func readSandboxPublicKey() (string, error) {
	path := "/app/sandbox/id_rsa.pub"
	if _, err := os.Stat(path); err != nil {
		path = "../../sandbox/id_rsa.pub"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

// migrateCloudCredentialsProviderGithub performs a table-rebuild migration on the
// cloud_credentials table in SQLite to allow the 'GITHUB' provider.
func migrateCloudCredentialsProviderGithub() error {
	var sqlStr string
	err := db.QueryRow("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cloud_credentials'").Scan(&sqlStr)
	if err != nil {
		return fmt.Errorf("failed to query sqlite_master for cloud_credentials: %w", err)
	}

	if strings.Contains(sqlStr, "GITHUB") {
		// Already migrated
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Create table cloud_credentials_new
	_, err = tx.Exec(`
		CREATE TABLE cloud_credentials_new (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			provider TEXT NOT NULL CHECK (provider IN ('AWS', 'GCP', 'SSH', 'GITHUB')),
			name TEXT NOT NULL,
			encrypted_data BLOB NOT NULL,
			nonce BLOB NOT NULL,
			auth_tag BLOB NOT NULL,
			key_fingerprint TEXT NOT NULL,
			created_by TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
			FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create cloud_credentials_new: %w", err)
	}

	// 2. Copy data
	_, err = tx.Exec(`
		INSERT INTO cloud_credentials_new (id, project_id, provider, name, encrypted_data, nonce, auth_tag, key_fingerprint, created_by, created_at, updated_at)
		SELECT id, project_id, provider, name, encrypted_data, nonce, auth_tag, key_fingerprint, created_by, created_at, updated_at
		FROM cloud_credentials;
	`)
	if err != nil {
		return fmt.Errorf("failed to copy cloud_credentials data: %w", err)
	}

	// 3. Drop old table
	_, err = tx.Exec("DROP TABLE cloud_credentials;")
	if err != nil {
		return fmt.Errorf("failed to drop old cloud_credentials: %w", err)
	}

	// 4. Rename
	_, err = tx.Exec("ALTER TABLE cloud_credentials_new RENAME TO cloud_credentials;")
	if err != nil {
		return fmt.Errorf("failed to rename cloud_credentials_new: %w", err)
	}

	log.Println("[DB] Migrated cloud_credentials provider check constraint to allow 'GITHUB'")
	return tx.Commit()
}


