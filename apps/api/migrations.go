package main

import (
	"fmt"
	"log"
)

// migration is one versioned, forward-only schema change applied after the
// legacy bootstrap in main() (the CREATE TABLE IF NOT EXISTS schema plus the
// three ad hoc SQLite-only rebuild migrations above it). New schema changes
// should be a new entry appended here instead of another ad hoc ALTER TABLE
// call in main() — see runMigrations for how these get tracked and applied.
//
// up receives a sqlExecer (satisfied by both *dbTx and *sql.Tx) so it runs
// through the same rebindSQL translation as every other query in this
// package, and so it never needs to know which wrapper it got.
type migration struct {
	version     int
	description string
	up          func(tx sqlExecer) error
}

// migrations must stay ordered by version, and a version must never be
// reused or reordered once it has shipped — schema_migrations records which
// versions have already run, per database.
var migrations = []migration{
	{
		version:     1,
		description: "baseline",
		up: func(tx sqlExecer) error {
			// No-op. Every table this version would have created already
			// exists in every environment, including production, via the
			// legacy `db.Exec(schemaQuery)` CREATE TABLE IF NOT EXISTS
			// bootstrap in main(). This entry only establishes version 1 as
			// the point schema_migrations starts tracking from — future
			// schema changes are migration 2 onward.
			return nil
		},
	},
	{
		version:     2,
		description: "add_email_verification_fields_to_users",
		up: func(tx sqlExecer) error {
			if _, err := tx.Exec("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE"); err != nil {
				return fmt.Errorf("failed to add email_verified: %w", err)
			}
			if _, err := tx.Exec("ALTER TABLE users ADD COLUMN verification_token TEXT"); err != nil {
				return fmt.Errorf("failed to add verification_token: %w", err)
			}
			// Raw migration DDL bypasses the bootstrap schema's pgSchema type
			// translation, and Postgres has no DATETIME type. SQLite needs
			// DATETIME (not TIMESTAMPTZ) so its driver parses the column
			// into time.Time on scan.
			expiresDDL := "ALTER TABLE users ADD COLUMN verification_expires_at DATETIME"
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				expiresDDL = pgSchema(expiresDDL)
			}
			if _, err := tx.Exec(expiresDDL); err != nil {
				return fmt.Errorf("failed to add verification_expires_at: %w", err)
			}
			// Existing accounts are grandfathered as verified
			if _, err := tx.Exec("UPDATE users SET email_verified = TRUE"); err != nil {
				return fmt.Errorf("failed to grandfather existing users: %w", err)
			}
			return nil
		},
	},
	{
		version:     3,
		description: "add_run_metadata_columns",
		up: func(tx sqlExecer) error {
			// Deliberately nullable, no default, no backfill: rows created
			// before this migration ran a mix of deploy and destroy with no
			// reliable way to recover which after the fact. Legacy rows stay
			// NULL and render "—" client-side, exactly as they do today —
			// only new rows going forward get a real value (see
			// obsidian_memory/08.6 section 2.1/2.2).
			if _, err := tx.Exec("ALTER TABLE pipeline_runs ADD COLUMN run_type TEXT"); err != nil {
				return fmt.Errorf("failed to add run_type: %w", err)
			}
			if _, err := tx.Exec("ALTER TABLE pipeline_runs ADD COLUMN target TEXT"); err != nil {
				return fmt.Errorf("failed to add target: %w", err)
			}
			return nil
		},
	},
	{
		version:     4,
		description: "add_onboarding_dismissed_to_users",
		up: func(tx sqlExecer) error {
			// Nullable, no default: NULL means "never dismissed" (the
			// dashboard's onboarding checklist still shows), non-NULL is the
			// dismissal timestamp. Same DATETIME/pgSchema dance as migration
			// 2's verification_expires_at — see its comment for why.
			ddl := "ALTER TABLE users ADD COLUMN onboarding_dismissed_at DATETIME"
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				ddl = pgSchema(ddl)
			}
			if _, err := tx.Exec(ddl); err != nil {
				return fmt.Errorf("failed to add onboarding_dismissed_at: %w", err)
			}
			return nil
		},
	},
	{
		version:     5,
		description: "add_activity_events_table",
		up: func(tx sqlExecer) error {
			// No FK constraints, deliberately: this is an append-only audit
			// log, not a referential-integrity-checked table — a deleted
			// project or user shouldn't either block the deletion (as a
			// RESTRICT FK would) or silently erase its own history (as a
			// CASCADE FK would). team_id is a convenience denormalization
			// (see insertActivityEvent) so team-scoped reads don't need a
			// JOIN through projects; it's looked up once at insert time and
			// never updated afterward, so a project moved to a different
			// team later keeps its old events' original team_id — that's the
			// honest historical record, not a bug.
			ddl := `CREATE TABLE activity_events (
				id TEXT PRIMARY KEY,
				team_id TEXT,
				project_id TEXT,
				actor_id TEXT,
				kind TEXT NOT NULL,
				payload_json TEXT NOT NULL DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				ddl = pgSchema(ddl)
			}
			if _, err := tx.Exec(ddl); err != nil {
				return fmt.Errorf("failed to create activity_events: %w", err)
			}
			if _, err := tx.Exec("CREATE INDEX idx_activity_events_team_id ON activity_events(team_id, created_at)"); err != nil {
				return fmt.Errorf("failed to create activity_events team index: %w", err)
			}
			return nil
		},
	},
	{
		version:     6,
		description: "add_archived_at_to_projects",
		up: func(tx sqlExecer) error {
			// Nullable, no default: NULL means "active" (today's only state,
			// unchanged for every existing row), non-NULL is the archive
			// timestamp. Same DATETIME/pgSchema dance as migration 4's
			// onboarding_dismissed_at.
			ddl := "ALTER TABLE projects ADD COLUMN archived_at DATETIME"
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				ddl = pgSchema(ddl)
			}
			if _, err := tx.Exec(ddl); err != nil {
				return fmt.Errorf("failed to add archived_at: %w", err)
			}
			return nil
		},
	},
	{
		version:     7,
		description: "add_expires_at_to_cloud_credentials",
		up: func(tx sqlExecer) error {
			// Nullable, no default: NULL means "no expiry tracked" (every
			// existing row, and every new one unless the caller opts in via
			// create/rotate's optional expires_at field). Same DATETIME/
			// pgSchema dance as migration 4's onboarding_dismissed_at.
			ddl := "ALTER TABLE cloud_credentials ADD COLUMN expires_at DATETIME"
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				ddl = pgSchema(ddl)
			}
			if _, err := tx.Exec(ddl); err != nil {
				return fmt.Errorf("failed to add expires_at: %w", err)
			}
			return nil
		},
	},
	{
		version:     8,
		description: "add_password_resets_table",
		up: func(tx sqlExecer) error {
			// token_hash, never the raw token (08.5 item G3's explicit spec) —
			// same reasoning as any credential secret in this app: a DB read
			// (backup, replica, compromised query) must not hand out something
			// directly usable to reset an account's password. used_at is
			// nullable rather than a DELETE-on-use so there's an audit trail;
			// single-use is enforced by checking used_at IS NULL at lookup time.
			ddl := `CREATE TABLE password_resets (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				token_hash TEXT NOT NULL,
				expires_at DATETIME NOT NULL,
				used_at DATETIME,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			)`
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				ddl = pgSchema(ddl)
			}
			if _, err := tx.Exec(ddl); err != nil {
				return fmt.Errorf("failed to create password_resets: %w", err)
			}
			if _, err := tx.Exec("CREATE INDEX idx_password_resets_token_hash ON password_resets(token_hash)"); err != nil {
				return fmt.Errorf("failed to create password_resets token_hash index: %w", err)
			}
			if _, err := tx.Exec("CREATE INDEX idx_password_resets_user_id ON password_resets(user_id)"); err != nil {
				return fmt.Errorf("failed to create password_resets user_id index: %w", err)
			}
			return nil
		},
	},
}

// runMigrations applies, in version order, any migration above not yet
// recorded in schema_migrations. Each migration runs in its own
// transaction: a failure rolls back that migration's own changes and stops
// startup (the caller treats a non-nil error as fatal) rather than leaving
// the schema half-migrated or silently skipping the rest.
func runMigrations(db *dbHandle) error {
	applied := make(map[int]bool)
	rows, err := db.Query("SELECT version FROM schema_migrations")
	if err != nil {
		return fmt.Errorf("failed to read schema_migrations: %w", err)
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return fmt.Errorf("failed to scan schema_migrations row: %w", err)
		}
		applied[v] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to read schema_migrations: %w", err)
	}
	rows.Close()

	for _, m := range migrations {
		if applied[m.version] {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("migration %d (%s): failed to start transaction: %w", m.version, m.description, err)
		}
		if err := m.up(tx); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d (%s): %w", m.version, m.description, err)
		}
		if _, err := tx.Exec("INSERT INTO schema_migrations (version, description) VALUES (?, ?)", m.version, m.description); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d (%s): failed to record as applied: %w", m.version, m.description, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migration %d (%s): failed to commit: %w", m.version, m.description, err)
		}
		log.Printf("[DB] Applied migration %d: %s\n", m.version, m.description)
	}
	return nil
}
