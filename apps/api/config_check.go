package main

import (
	"fmt"
	"strings"
)

// devJWTSecret is the fallback init() in main.go signs sessions with when
// JWT_SECRET is unset. It lives in the public source tree, so any deployment
// still using it has session tokens anyone can forge.
const devJWTSecret = "whiparc_workspace_orchestration_secret_key_98765!"

// insecureDevOverrideEnv lets a throwaway local Postgres run (for example
// `docker compose -f docker-compose.hosted.yml up` with no .env) skip the
// production checks below. It must never be set on a real deployment.
const insecureDevOverrideEnv = "WHIPARC_ALLOW_INSECURE_DEV"

// validateProductionConfig refuses to let the API start in a configuration
// that fails open. DB_DRIVER=postgres is this codebase's established signal
// for "hosted deployment" (local dev runs on SQLite), so under it a missing
// JWT_SECRET would silently sign every session with devJWTSecret, and a
// missing FRONTEND_URL would widen both CORS and the workspace WebSocket
// origin check to "*". Returns nil outside Postgres mode.
//
// getenv is injected so tests don't have to mutate the process environment.
func validateProductionConfig(backend string, getenv func(string) string) error {
	if backend != "postgres" {
		return nil
	}
	if strings.EqualFold(strings.TrimSpace(getenv(insecureDevOverrideEnv)), "true") {
		return nil
	}

	var problems []string

	switch secret := getenv("JWT_SECRET"); {
	case secret == "":
		problems = append(problems, "JWT_SECRET is not set (sessions would be signed with the public development key)")
	case secret == devJWTSecret:
		problems = append(problems, "JWT_SECRET is set to the public development key")
	}

	switch origin := strings.TrimSpace(getenv("FRONTEND_URL")); {
	case origin == "":
		problems = append(problems, "FRONTEND_URL is not set (CORS and WebSocket origin checks would accept any origin)")
	case origin == "*":
		problems = append(problems, `FRONTEND_URL is "*" (CORS and WebSocket origin checks would accept any origin)`)
	}

	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("refusing to start with DB_DRIVER=postgres and an insecure configuration: %s. "+
		"Set these in the deployment environment (see .env.example); for a throwaway local run only, set %s=true",
		strings.Join(problems, "; "), insecureDevOverrideEnv)
}
