package main

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"api/runner"
	"api/vault"
)

// Sandbox Agent pairing/registration handlers — Phase 1 opt-in beta.
// See obsidian_memory/08.4 (rollout plan) and 03.6 (bridging protocol).
//
// These handlers are only reachable when SANDBOX_AGENT_BETA=true (see the
// conditional route registration in main.go); the Gateway service
// (apps/agent-gateway) is the thing that actually terminates the Agent's
// outbound tunnel, and calls back into these endpoints over HTTP so this API
// stays the single source of truth for pairing state.

// gatewayRunnerSecret authenticates the Gateway's server-to-server callback
// and, indirectly, the "whiparc sandbox proxy" ProxyCommand helper the
// Runner spawns — both present it as X-Gateway-Runner-Secret.
func gatewayRunnerSecret() string {
	return os.Getenv("GATEWAY_RUNNER_SECRET")
}

// gatewayBaseURL resolves the Agent Gateway's base URL, shared by every
// apps/api -> Gateway server-to-server call (pairing approval, agent
// resolution, and the revoke-triggered disconnect below).
func gatewayBaseURL() string {
	if u := os.Getenv("GATEWAY_URL"); u != "" {
		return u
	}
	return "http://localhost:9090"
}

// POST /api/projects/{id}/agents/register
// Called by `whiparc sandbox up` once the CLI has generated a
// per-installation keypair and baked the public half into the local sandbox
// SSH containers. The private half is uploaded once, over this already
// project-authenticated channel, and stored encrypted — never as a bare file
// server-side — exactly like the existing SSH cloud_credentials flow.
func handleRegisterAgent(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		AgentID       string `json:"agent_id"`
		Name          string `json:"name"`
		PublicKey     string `json:"public_key"`
		PrivateKeyPEM string `json:"private_key_pem"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	if payload.AgentID == "" || payload.PublicKey == "" || payload.PrivateKeyPEM == "" {
		http.Error(w, "Missing agent_id, public_key, or private_key_pem in payload", http.StatusBadRequest)
		return
	}
	if payload.Name == "" {
		payload.Name = payload.AgentID
	}

	cipherText, nonce, authTag, err := vault.Encrypt([]byte(payload.PrivateKeyPEM))
	if err != nil {
		http.Error(w, "Vault encryption failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	fingerprint := vault.Fingerprint("SSH", []byte(payload.PrivateKeyPEM))

	recordID := generateUUID()
	_, err = db.Exec(`INSERT INTO paired_agents
		(id, project_id, agent_id, name, public_key, encrypted_private_key, nonce, auth_tag, key_fingerprint, status, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
		recordID, projectID, payload.AgentID, payload.Name, payload.PublicKey, cipherText, nonce, authTag, fingerprint, user.ID)
	if err != nil {
		if isUniqueConstraintErr(err) {
			http.Error(w, "An agent with this agent_id is already registered", http.StatusConflict)
			return
		}
		http.Error(w, "Failed to register agent: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":              recordID,
		"agent_id":        payload.AgentID,
		"status":          "PENDING",
		"key_fingerprint": fingerprint,
	})
}

// POST /api/projects/{id}/agents/pair
// Approves a pending device-authorization pairing request on the Gateway.
// `whiparc sandbox up` calls this with the user_code it printed from the
// Gateway's /device/code response, immediately after requesting it — this API
// call is the RBAC check (RequireProjectRole("EDITOR") below) that stands in
// for the browser approval step described in obsidian_memory/06.3, so pairing
// stays fully scriptable in this beta without a dedicated frontend page.
func handlePairAgent(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	var payload struct {
		UserCode string `json:"user_code"`
		AgentID  string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	if payload.UserCode == "" {
		http.Error(w, "Missing user_code in payload", http.StatusBadRequest)
		return
	}

	if err := approveAgentPairing(payload.UserCode, projectID, payload.AgentID); err != nil {
		http.Error(w, "Failed to approve pairing: "+err.Error(), http.StatusBadGateway)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// approveAgentPairing calls the Agent Gateway's internal-only /device/approve
// endpoint (see apps/agent-gateway/internal/server), authenticated with the
// same shared secret used for /runner/dial and the status callback.
func approveAgentPairing(userCode, projectID, agentID string) error {
	gatewayURL := gatewayBaseURL()

	body, err := json.Marshal(map[string]string{
		"user_code":  userCode,
		"project_id": projectID,
		"agent_id":   agentID,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, gatewayURL+"/device/approve", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gateway-Runner-Secret", gatewayRunnerSecret())

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("gateway returned status %d", resp.StatusCode)
	}
	return nil
}

// GET /api/projects/{id}/agents/{agentId}
// Polled by `whiparc sandbox up` (waiting for PENDING -> ACTIVE) and
// `whiparc sandbox status`.
func handleGetAgentStatus(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	agentID := r.PathValue("agentId")

	var name, status, fingerprint string
	var registeredAt string
	var lastSeenAt sql.NullString
	err := db.QueryRow(`SELECT name, status, key_fingerprint, registered_at, last_seen_at
		FROM paired_agents WHERE project_id = ? AND agent_id = ?`, projectID, agentID).
		Scan(&name, &status, &fingerprint, &registeredAt, &lastSeenAt)
	if err == sql.ErrNoRows {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"agent_id":        agentID,
		"name":            name,
		"status":          status,
		"key_fingerprint": fingerprint,
		"registered_at":   registeredAt,
	}
	if lastSeenAt.Valid {
		resp["last_seen_at"] = lastSeenAt.String
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// GET /api/projects/{id}/agents/latest
// Lets the frontend show a live "Sandbox Agent" status badge (see
// obsidian_memory/08.4's Phase 2 daemon-install/heartbeat entries) without
// needing to already know a specific agent_id — the only other status route
// requires one. Returns 404 when no agent has ever been paired for this
// project; the frontend treats that as "hide the badge," not an error, the
// same way it treats a REVOKED status. Deliberately omits key_fingerprint —
// not needed for a badge, keep this response minimal.
func handleGetLatestAgentStatus(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	var agentID, status string
	var lastSeenAt sql.NullString
	err := db.QueryRow(`SELECT agent_id, status, last_seen_at
		FROM paired_agents WHERE project_id = ?
		ORDER BY registered_at DESC LIMIT 1`, projectID).
		Scan(&agentID, &status, &lastSeenAt)
	if err == sql.ErrNoRows {
		http.Error(w, "No paired agent for this project", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"agent_id": agentID,
		"status":   status,
	}
	if lastSeenAt.Valid {
		resp["last_seen_at"] = lastSeenAt.String
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// GET /api/projects/{id}/agents
// Lists every agent ever paired to a project, newest first — the management
// view 06.3 originally specced ("listing paired agents with the ability to
// revoke any one of them") but that was never built in Phase 1/2. Returns an
// empty array (not 404) when none have ever been paired, unlike
// handleGetLatestAgentStatus — a settings page rendering a list wants "no
// rows," not a 404 to special-case.
func handleListAgents(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	rows, err := db.Query(`SELECT agent_id, name, status, key_fingerprint, registered_at, last_seen_at
		FROM paired_agents WHERE project_id = ? ORDER BY registered_at DESC`, projectID)
	if err != nil {
		log.Printf("[SANDBOX AGENT] Failed to list paired agents for project %s: %v\n", projectID, err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	agents := make([]map[string]interface{}, 0)
	for rows.Next() {
		var agentID, name, status, fingerprint, registeredAt string
		var lastSeenAt sql.NullString
		if err := rows.Scan(&agentID, &name, &status, &fingerprint, &registeredAt, &lastSeenAt); err != nil {
			log.Printf("[SANDBOX AGENT] Failed to scan paired agent row for project %s: %v\n", projectID, err)
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		entry := map[string]interface{}{
			"agent_id":        agentID,
			"name":            name,
			"status":          status,
			"key_fingerprint": fingerprint,
			"registered_at":   registeredAt,
		}
		if lastSeenAt.Valid {
			entry["last_seen_at"] = lastSeenAt.String
		}
		agents = append(agents, entry)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(agents)
}

// POST /api/projects/{id}/agents/{agentId}/revoke
// Closes the other half of the management-view gap: marks the agent REVOKED,
// invalidates any tokens issued for it (agent_pairing_tokens — see
// handleRegisterAgentToken above), and best-effort asks the Gateway to drop
// the tunnel immediately if it's currently connected, rather than leaving a
// revoked-but-still-live session to be caught only by its own next
// disconnect. A DB-side revoke is what actually matters (it blocks every
// future reconnect and deploy pre-flight, per latestPairedAgentStatus/
// resolvePairedAgent) — the Gateway disconnect is a responsiveness nicety on
// top of that, so its failure is logged, not fatal to this request.
func handleRevokeAgent(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	agentID := r.PathValue("agentId")

	res, err := db.Exec(`UPDATE paired_agents SET status = 'REVOKED' WHERE project_id = ? AND agent_id = ?`,
		projectID, agentID)
	if err != nil {
		log.Printf("[SANDBOX AGENT] Failed to revoke agent %s for project %s: %v\n", agentID, projectID, err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	if _, err := db.Exec(`UPDATE agent_pairing_tokens SET revoked_at = datetime('now')
		WHERE agent_id = ? AND revoked_at IS NULL`, agentID); err != nil {
		log.Printf("[SANDBOX AGENT] Failed to revoke pairing tokens for agent %s: %v\n", agentID, err)
	}

	if err := disconnectAgentOnGateway(agentID); err != nil {
		log.Printf("[SANDBOX AGENT] Failed to disconnect agent %s from gateway after revoke: %v\n", agentID, err)
	}

	w.WriteHeader(http.StatusNoContent)
}

// disconnectAgentOnGateway asks the Gateway to close agentID's live tunnel
// session right now, if it has one, via the same shared-secret server-to-
// server auth used by approveAgentPairing. A 404 (agent not currently
// connected) is expected and not an error — the DB-side revoke above is
// what matters for an agent that isn't live at revoke time.
func disconnectAgentOnGateway(agentID string) error {
	req, err := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/internal/agents/disconnect?agent_id=%s", gatewayBaseURL(), agentID), nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Gateway-Runner-Secret", gatewayRunnerSecret())

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("gateway returned status %d", resp.StatusCode)
	}
	return nil
}

// POST /api/internal/agents/{agentId}/callback
// Called by the Agent Gateway (not a browser/CLI client) once an Agent's
// tunnel actually connects, authenticated via the shared X-Gateway-Runner-Secret
// rather than a user JWT — the Gateway has no concept of Whiparc user
// sessions. This is a deliberately minimal, known Phase-1 auth boundary; see
// apps/agent-gateway/README.md.
func handleAgentStatusCallback(w http.ResponseWriter, r *http.Request) {
	secret := gatewayRunnerSecret()
	if secret == "" || r.Header.Get("X-Gateway-Runner-Secret") != secret {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	agentID := r.PathValue("agentId")
	var payload struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	if payload.Status != "ACTIVE" && payload.Status != "REVOKED" && payload.Status != "DISCONNECTED" {
		http.Error(w, "status must be ACTIVE, REVOKED, or DISCONNECTED", http.StatusBadRequest)
		return
	}

	res, err := db.Exec(`UPDATE paired_agents SET status = ?, last_seen_at = datetime('now') WHERE agent_id = ?`,
		payload.Status, agentID)
	if err != nil {
		// http.Error only writes the response body — it does not log
		// server-side, so without this the real error was only ever visible
		// in the HTTP response the Gateway's apiclient discarded (see
		// obsidian_memory/07.2's SQLite-locking incident this was found from).
		log.Printf("[SANDBOX AGENT] Failed to update status for agent %s to %s: %v\n", agentID, payload.Status, err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// hashAgentToken returns the hex SHA-256 digest of a Gateway-issued agent
// token. apps/api never sees or stores the raw token — only the Gateway and
// the CLI ever hold it in plaintext (the CLI's own on-disk copy is already
// permission-restricted, see obsidian_memory/08.4's daemon-install entry) —
// this store only needs to answer "does this token exist and is it live,"
// which a one-way hash comparison does exactly as well as a stored plaintext
// value would, with a smaller blast radius if this database were ever read.
func hashAgentToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// POST /api/internal/agent-tokens
// Called by the Agent Gateway immediately after it issues a new agent token
// (PollToken's first successful poll after approval — see
// apps/agent-gateway/internal/server's handleToken). This is what lets a
// token issued by one Gateway process still validate after that process
// restarts: obsidian_memory/08.4 tracked the Gateway's previously in-memory-
// only pairing.Server.byToken map as a real Phase 3 prerequisite ("every
// Gateway restart silently strands every currently-connected user's agent"),
// and this is the persistence half of the fix — apps/api stays the single
// source of truth, the Gateway stays DB-agnostic per its own README, matching
// the existing /api/internal/agents/{agentId}/callback pattern exactly.
func handleRegisterAgentToken(w http.ResponseWriter, r *http.Request) {
	secret := gatewayRunnerSecret()
	if secret == "" || r.Header.Get("X-Gateway-Runner-Secret") != secret {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		Token     string `json:"token"`
		ProjectID string `json:"project_id"`
		AgentID   string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	if payload.Token == "" || payload.ProjectID == "" {
		http.Error(w, "Missing token or project_id in payload", http.StatusBadRequest)
		return
	}

	upsertQuery := `INSERT OR REPLACE INTO agent_pairing_tokens (token_hash, project_id, agent_id, issued_at, revoked_at)
		VALUES (?, ?, ?, datetime('now'), NULL)`
	if dbBackend == "postgres" {
		// Postgres has no "OR REPLACE" — token_hash is the primary key, so an
		// upsert on conflict with it is the equivalent behavior.
		upsertQuery = `INSERT INTO agent_pairing_tokens (token_hash, project_id, agent_id, issued_at, revoked_at)
			VALUES (?, ?, ?, datetime('now'), NULL)
			ON CONFLICT (token_hash) DO UPDATE SET
				project_id = EXCLUDED.project_id,
				agent_id = EXCLUDED.agent_id,
				issued_at = EXCLUDED.issued_at,
				revoked_at = EXCLUDED.revoked_at`
	}
	_, err := db.Exec(upsertQuery, hashAgentToken(payload.Token), payload.ProjectID, payload.AgentID)
	if err != nil {
		log.Printf("[SANDBOX AGENT] Failed to persist agent pairing token for project %s: %v\n", payload.ProjectID, err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// POST /api/internal/agent-tokens/validate
// Called by the Gateway's handleAgentConnect only as a fallback, after its own
// in-memory pairing.Server.LookupToken misses — the common case (a token
// looked up by the same process that issued it) never reaches this endpoint,
// keeping the hot path free of a network round-trip. A miss here means either
// the token never existed, or it was revoked (see the future agent-revoke
// endpoint tracked alongside this in obsidian_memory/08.4).
func handleValidateAgentToken(w http.ResponseWriter, r *http.Request) {
	secret := gatewayRunnerSecret()
	if secret == "" || r.Header.Get("X-Gateway-Runner-Secret") != secret {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	if payload.Token == "" {
		http.Error(w, "Missing token in payload", http.StatusBadRequest)
		return
	}

	var projectID string
	var agentID sql.NullString
	err := db.QueryRow(`SELECT project_id, agent_id FROM agent_pairing_tokens
		WHERE token_hash = ? AND revoked_at IS NULL`, hashAgentToken(payload.Token)).
		Scan(&projectID, &agentID)
	if err == sql.ErrNoRows {
		http.Error(w, "Token not found or revoked", http.StatusNotFound)
		return
	} else if err != nil {
		log.Printf("[SANDBOX AGENT] Failed to validate agent pairing token: %v\n", err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{"project_id": projectID}
	if agentID.Valid {
		resp["agent_id"] = agentID.String
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// resolvePairedAgent looks up the active paired agent for a project (if any)
// and decrypts its private key, returning an *runner.AgentContext for
// RunPipeline. Returns nil whenever the beta flag is off, no agent is paired,
// or decryption fails — callers treat nil exactly like "no local_agent
// target", falling back to the existing live/docker behavior untouched.
func resolvePairedAgent(projectID string) *runner.AgentContext {
	if os.Getenv("SANDBOX_AGENT_BETA") != "true" {
		return nil
	}

	var agentID string
	var cipherText, nonce, authTag []byte
	err := db.QueryRow(`SELECT agent_id, encrypted_private_key, nonce, auth_tag
		FROM paired_agents WHERE project_id = ? AND status = 'ACTIVE'
		ORDER BY registered_at DESC LIMIT 1`, projectID).
		Scan(&agentID, &cipherText, &nonce, &authTag)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("[SANDBOX AGENT] Failed to look up paired agent for project %s: %v\n", projectID, err)
		}
		return nil
	}

	plainText, err := vault.Decrypt(cipherText, nonce, authTag)
	if err != nil {
		log.Printf("[SANDBOX AGENT] Failed to decrypt agent key for project %s: %v\n", projectID, err)
		return nil
	}

	return &runner.AgentContext{
		AgentID:       agentID,
		ProjectID:     projectID,
		GatewayURL:    gatewayBaseURL(),
		PrivateKeyPEM: string(plainText),
	}
}

// latestPairedAgentStatus returns the status of a project's most-recently-
// registered paired agent (by registered_at), if any. Unlike
// resolvePairedAgent, this does not filter to status = 'ACTIVE' — the whole
// point is to see PENDING/DISCONNECTED rows resolvePairedAgent's nil would
// otherwise hide, so handleDeploy can reject cleanly instead of silently
// falling back to Docker-sandbox/live behavior (see obsidian_memory/08.4's
// Phase 2 heartbeat/reconnect entry). ok is false when the beta flag is off,
// no agent has ever been registered for this project, or the query fails
// (logged, then treated like "no data" so a DB hiccup here fails open to
// existing deploy behavior rather than blocking every deploy).
func latestPairedAgentStatus(projectID string) (status string, ok bool) {
	if os.Getenv("SANDBOX_AGENT_BETA") != "true" {
		return "", false
	}
	err := db.QueryRow(`SELECT status FROM paired_agents WHERE project_id = ?
		ORDER BY registered_at DESC LIMIT 1`, projectID).Scan(&status)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("[SANDBOX AGENT] Failed to look up latest paired agent status for project %s: %v\n", projectID, err)
		}
		return "", false
	}
	return status, true
}

// ---- Phase 3: default-flip gating (obsidian_memory/08.4) ----
//
// New free-tier signups default to local-sandbox-only; the hosted in-
// container sandbox is repositioned as a paid convenience. Existing free
// users already on the hosted sandbox get a migration notice and a grace
// period rather than an unannounced cutoff — but per the product decision
// recorded in 08.4, the cutoff at the end of that grace period is hard, not
// an indefinite grandfather clause. Modeled with two dates instead of one:
//   - SANDBOX_AGENT_DEFAULT_CUTOFF: a brand-new signup created on/after this
//     date is gated immediately.
//   - SANDBOX_AGENT_GRACE_PERIOD_DAYS after that cutoff: the date existing
//     (pre-cutoff) signups also become gated. Until then they are exempt.
// Both env vars are opt-in — with no cutoff configured, gating never applies
// at all, the same safe-by-default posture as SANDBOX_AGENT_BETA itself.

// sandboxAgentDefaultEnabled reports whether Phase 3's default-flip gating is
// switched on at all. Deliberately requires SANDBOX_AGENT_BETA too: gating
// without it would block every FREE sandbox deploy with no way to ever
// satisfy it, since the pairing routes wouldn't even be registered — that's
// a misconfiguration to guard against, not a valid "gate everyone" mode.
func sandboxAgentDefaultEnabled() bool {
	return os.Getenv("SANDBOX_AGENT_BETA") == "true" && os.Getenv("SANDBOX_AGENT_DEFAULT") == "true"
}

// sandboxAgentDefaultCutoff parses SANDBOX_AGENT_DEFAULT_CUTOFF (YYYY-MM-DD).
// ok is false when unset or unparseable, in which case gating never applies
// — an operator must deliberately set a real date to turn this on.
func sandboxAgentDefaultCutoff() (cutoff time.Time, ok bool) {
	raw := os.Getenv("SANDBOX_AGENT_DEFAULT_CUTOFF")
	if raw == "" {
		return time.Time{}, false
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		log.Printf("[SANDBOX AGENT] Invalid SANDBOX_AGENT_DEFAULT_CUTOFF %q (want YYYY-MM-DD), ignoring: %v\n", raw, err)
		return time.Time{}, false
	}
	return t, true
}

// sandboxAgentGracePeriodEnd is when an existing (pre-cutoff) FREE user's
// grace period on the hosted sandbox ends and they become gated too, same as
// a new signup. Defaults to 30 days after cutoff.
func sandboxAgentGracePeriodEnd(cutoff time.Time) time.Time {
	days := 30
	if raw := os.Getenv("SANDBOX_AGENT_GRACE_PERIOD_DAYS"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v >= 0 {
			days = v
		}
	}
	return cutoff.AddDate(0, 0, days)
}

// teamPlanForProject resolves the plan of the team that owns a project,
// fresh from the DB every call — the only source of truth for plan since
// billing moved to teams (product-memory 08.5 item G1). Every project has
// exactly one owning team (projects.team_id is NOT NULL), so this has no
// orphan/ambiguous case to handle, unlike resolving "the user's plan" would
// once a user can belong to several teams with different plans.
func teamPlanForProject(projectID string) (plan string, ok bool) {
	err := db.QueryRow("SELECT t.plan FROM projects p JOIN teams t ON t.id = p.team_id WHERE p.id = ?", projectID).Scan(&plan)
	if err != nil {
		return "", false
	}
	return plan, true
}

// sandboxDeployGatedForFreeTier reports whether a sandbox deploy must be
// rejected under the default flip: a FREE-plan team, gating actually active,
// and — depending on whether the deploying user signed up before or after
// the cutoff — either past the flip date outright or past their grace
// period. Fails open (returns false) on any DB error, matching this file's
// existing style for non-critical lookups (e.g. latestPairedAgentStatus) — a
// lookup hiccup here should not block every free user's deploy.
func sandboxDeployGatedForFreeTier(userID, projectID string) bool {
	// Ordered so the two env-only checks (cheap, no DB) short-circuit before
	// either DB lookup below — same property the pre-G1 version had with its
	// plan-as-parameter signature, preserved here even though resolving plan
	// now costs a query itself (see sandbox_default_flip_test.go).
	if !sandboxAgentDefaultEnabled() {
		return false
	}
	cutoff, ok := sandboxAgentDefaultCutoff()
	if !ok {
		return false
	}
	now := time.Now()
	if now.Before(cutoff) {
		return false
	}

	plan, ok := teamPlanForProject(projectID)
	if !ok || plan != "FREE" {
		return false
	}

	var createdAtStr string
	if err := db.QueryRow("SELECT created_at FROM users WHERE id = ?", userID).Scan(&createdAtStr); err != nil {
		log.Printf("[SANDBOX AGENT] Failed to look up user %s created_at for default-flip gating: %v\n", userID, err)
		return false
	}
	createdAt, err := time.Parse("2006-01-02 15:04:05", strings.Replace(createdAtStr, "T", " ", 1))
	if err != nil {
		log.Printf("[SANDBOX AGENT] Failed to parse created_at %q for user %s: %v\n", createdAtStr, userID, err)
		return false
	}

	if !createdAt.Before(cutoff) {
		return true // signed up on/after the flip date — gated immediately
	}
	return now.After(sandboxAgentGracePeriodEnd(cutoff)) // existing user — gated once their grace period ends
}

// GET /api/projects/{id}/sandbox-migration-status
// Lets the workspace header show a migration-notice banner before a deploy
// ever gets rejected by sandboxDeployGatedForFreeTier — the "migration
// notice and a grace period, not an unannounced cutoff" half of Phase 3.
// 404 when the default-flip isn't configured at all, or the caller isn't on
// the FREE plan — both mean "nothing to show," matching the existing
// agents/latest badge-hiding convention.
func handleGetSandboxMigrationStatus(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Not applicable", http.StatusNotFound)
		return
	}
	plan, planOK := teamPlanForProject(projectID)
	if !planOK || plan != "FREE" {
		http.Error(w, "Not applicable", http.StatusNotFound)
		return
	}
	cutoff, cutoffOK := sandboxAgentDefaultCutoff()
	if !sandboxAgentDefaultEnabled() || !cutoffOK {
		http.Error(w, "Sandbox Agent default-flip not configured", http.StatusNotFound)
		return
	}

	resp := map[string]interface{}{
		"gated":            sandboxDeployGatedForFreeTier(user.ID, projectID),
		"has_active_agent": resolvePairedAgent(projectID) != nil,
		"cutoff":           cutoff.Format("2006-01-02"),
		"grace_period_end": sandboxAgentGracePeriodEnd(cutoff).Format("2006-01-02"),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// migratePairedAgentsStatusAllowsDisconnected rebuilds the paired_agents
// table so its status CHECK constraint allows 'DISCONNECTED', added by
// obsidian_memory/08.4's Phase 2 heartbeat/reconnect item so the Gateway can
// report a dead tunnel distinctly from a never-paired or revoked agent.
// SQLite has no ALTER TABLE ... ALTER COLUMN, and a CHECK constraint isn't
// even visible via PRAGMA table_info (unlike migrateUsersPasswordHashNullable's
// NOT NULL flag, see oauth.go) — this inspects the table's DDL directly via
// sqlite_master and does the same create/copy/drop/rename dance if
// 'DISCONNECTED' isn't present yet. Idempotent: a no-op on every boot after
// the first successful run, and a no-op if the table doesn't exist yet
// (schemaQuery's own CREATE TABLE already has DISCONNECTED baked in for a
// fresh database).
func migratePairedAgentsStatusAllowsDisconnected() error {
	var ddl string
	err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'paired_agents'`).Scan(&ddl)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if strings.Contains(ddl, "'DISCONNECTED'") {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		CREATE TABLE paired_agents_new (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			agent_id TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			public_key TEXT NOT NULL,
			encrypted_private_key BLOB NOT NULL,
			nonce BLOB NOT NULL,
			auth_tag BLOB NOT NULL,
			key_fingerprint TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'DISCONNECTED')),
			created_by TEXT NOT NULL,
			registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_seen_at DATETIME,
			FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
			FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
		);
	`); err != nil {
		return fmt.Errorf("create paired_agents_new: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO paired_agents_new SELECT id, project_id, agent_id, name, public_key, encrypted_private_key, nonce, auth_tag, key_fingerprint, status, created_by, registered_at, last_seen_at FROM paired_agents;`); err != nil {
		return fmt.Errorf("copy paired_agents rows: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE paired_agents;`); err != nil {
		return fmt.Errorf("drop old paired_agents: %w", err)
	}
	if _, err := tx.Exec(`ALTER TABLE paired_agents_new RENAME TO paired_agents;`); err != nil {
		return fmt.Errorf("rename paired_agents_new: %w", err)
	}

	log.Println("[DB] Migrated paired_agents.status CHECK constraint to allow DISCONNECTED")
	return tx.Commit()
}

// isUniqueConstraintErr detects a unique-constraint violation across both
// backends: SQLite reports "UNIQUE constraint failed" while Postgres reports
// "duplicate key value violates unique constraint" (lowercase) — matching
// only the uppercase SQLite phrasing let these fall through to a generic 500
// on Postgres instead of the intended friendly conflict response (the same
// bug already fixed for the signup path in main.go's handleSignup).
func isUniqueConstraintErr(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}
