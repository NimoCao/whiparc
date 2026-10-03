package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// createPersonalTeam creates the default personal workspace team + OWNER
// membership for a brand-new user. Shared by password signup (handleSignup)
// and first-time OAuth login (findOrCreateOAuthUser in oauth.go) so the two
// account-creation paths can't silently drift apart — an OAuth user who
// never gets a personal team has nowhere to create projects.
func createPersonalTeam(tx sqlExecer, userID, name string) error {
	teamID := fmt.Sprintf("team_%d", time.Now().UnixNano())
	slug := "personal-" + userID
	if _, err := tx.Exec("INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)", teamID, name+"'s Personal Workspace", slug, userID); err != nil {
		return fmt.Errorf("failed to create personal team: %w", err)
	}

	tmemID := fmt.Sprintf("tmem_%d", time.Now().UnixNano())
	if _, err := tx.Exec("INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)", tmemID, teamID, userID, "OWNER"); err != nil {
		return fmt.Errorf("failed to join personal team: %w", err)
	}

	return nil
}

type contextKey string

const userContextKey contextKey = "user"

// AuthMiddleware extracts JWT token from Authorization header or Query params and puts claims in context
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers for preflight or regular request
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		tokenStr := r.Header.Get("Authorization")
		if tokenStr != "" {
			tokenStr = strings.TrimPrefix(tokenStr, "Bearer ")
		} else {
			tokenStr = r.URL.Query().Get("token")
		}

		if tokenStr == "" {
			http.Error(w, "Unauthorized: Authorization token is required", http.StatusUnauthorized)
			return
		}

		claims, err := VerifyToken(tokenStr)
		if err != nil {
			http.Error(w, "Unauthorized: "+err.Error(), http.StatusUnauthorized)
			return
		}

		// JWTs are stateless, so a token minted before an account was deleted
		// would otherwise keep working until it expires. One indexed
		// primary-key lookup closes that window. Only a definitive "no such
		// user" rejects the request; any other DB error falls through so a
		// transient blip doesn't log everyone out (handlers hit the DB anyway).
		if db != nil {
			var one int
			if err := db.QueryRow("SELECT 1 FROM users WHERE id = ?", claims.ID).Scan(&one); err == sql.ErrNoRows {
				http.Error(w, "Unauthorized: this account no longer exists", http.StatusUnauthorized)
				return
			}
		}

		ctx := context.WithValue(r.Context(), userContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetUserFromContext helper to extract claims from context
func GetUserFromContext(r *http.Request) (*TokenClaims, bool) {
	claims, ok := r.Context().Value(userContextKey).(*TokenClaims)
	return claims, ok
}

// checkProjectAccess implements the access rule RequireProjectRole enforces
// as middleware (Viewer <= Editor <= Admin), factored out so a handler keyed
// by a resource ID other than the project ID itself — e.g. handleGetRunByID
// and handleWebSocket, both keyed by run ID — can perform the identical
// check once it has resolved that resource's project ID. Returns allowed;
// status/message are only meaningful when allowed is false.
func checkProjectAccess(userID, projectID, minRole string) (allowed bool, status int, message string) {
	roleLevels := map[string]int{
		"VIEWER": 1,
		"EDITOR": 2,
		"ADMIN":  3,
	}

	var visibility, createdBy, teamId string
	err := db.QueryRow("SELECT visibility, created_by, team_id FROM projects WHERE id = ?", projectID).Scan(&visibility, &createdBy, &teamId)
	if err != nil {
		return false, http.StatusNotFound, "Project not found"
	}

	// If user is the creator of the project, they have full access (Admin level)
	if createdBy == userID {
		return true, 0, ""
	}

	// If project is public and minRole is VIEWER, allow access
	if visibility == "PUBLIC" && minRole == "VIEWER" {
		return true, 0, ""
	}

	// Query project memberships
	var userRole string
	err = db.QueryRow("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?", projectID, userID).Scan(&userRole)
	if err != nil {
		// If not a direct project member, check if they are in the team that owns the project
		var teamRole string
		err = db.QueryRow("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?", teamId, userID).Scan(&teamRole)
		if err == nil && (teamRole == "OWNER" || teamRole == "ADMIN") {
			// Team admins/owners act as project admins
			return true, 0, ""
		}
		return false, http.StatusForbidden, "Forbidden: Access denied to this project"
	}

	if roleLevels[userRole] < roleLevels[minRole] {
		return false, http.StatusForbidden, "Forbidden: Insufficient privileges"
	}

	return true, 0, ""
}

// checkTeamAccess is checkProjectAccess's team-level twin (Member <= Admin
// <= Owner), used by RequireTeamRole and by handlers that need to check
// team membership for a resource key by something other than the team ID
// itself. Returns allowed; status/message are only meaningful when allowed
// is false.
func checkTeamAccess(userID, teamID, minRole string) (allowed bool, status int, message string) {
	roleLevels := map[string]int{
		"MEMBER": 1,
		"ADMIN":  2,
		"OWNER":  3,
	}

	var exists string
	if err := db.QueryRow("SELECT id FROM teams WHERE id = ?", teamID).Scan(&exists); err != nil {
		return false, http.StatusNotFound, "Team not found"
	}

	var userRole string
	err := db.QueryRow("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?", teamID, userID).Scan(&userRole)
	if err != nil {
		return false, http.StatusForbidden, "Forbidden: Access denied to this team"
	}

	if roleLevels[userRole] < roleLevels[minRole] {
		return false, http.StatusForbidden, "Forbidden: Insufficient privileges"
	}

	return true, 0, ""
}

// RequireTeamRole checks if the user has access to the team with at least the minimum role (Member <= Admin <= Owner)
func RequireTeamRole(minRole string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := GetUserFromContext(r)
			if !ok {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			teamId := r.PathValue("id")
			if teamId == "" {
				http.Error(w, "Bad Request: Team ID is required", http.StatusBadRequest)
				return
			}

			if allowed, status, message := checkTeamAccess(user.ID, teamId, minRole); !allowed {
				http.Error(w, message, status)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireProjectRole checks if the user has access to the project with at least the minimum role (Viewer <= Editor <= Admin)
func RequireProjectRole(minRole string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := GetUserFromContext(r)
			if !ok {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			// Parse projectId from path value (Go 1.22 path wildcard)
			projectId := r.PathValue("id")
			if projectId == "" {
				projectId = r.PathValue("projectId")
			}
			if projectId == "" {
				projectId = r.URL.Query().Get("projectId")
			}

			if projectId == "" {
				http.Error(w, "Bad Request: Project ID is required", http.StatusBadRequest)
				return
			}

			if allowed, status, message := checkProjectAccess(user.ID, projectId, minRole); !allowed {
				http.Error(w, message, status)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
