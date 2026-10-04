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
	{
		version:     9,
		description: "add_avatar_url_to_users",
		up: func(tx sqlExecer) error {
			// Nullable, no default: NULL means "no avatar set" (every existing
			// row), every UI spot that renders it falls back to initials. Plain
			// TEXT needs no DATETIME/pgSchema dance (that's only for date/time
			// columns — see migration 2's verification_expires_at comment).
			if _, err := tx.Exec("ALTER TABLE users ADD COLUMN avatar_url TEXT"); err != nil {
				return fmt.Errorf("failed to add avatar_url: %w", err)
			}
			return nil
		},
	},
	{
		version:     10,
		description: "add_pending_email_change_to_users",
		up: func(tx sqlExecer) error {
			// Columns on `users`, not a separate table like password_resets —
			// there's only ever one *live* pending change per account (a new
			// request overwrites the old one), so there's no history worth
			// keeping and no separate single-use/audit bookkeeping needed the
			// way password_resets' used_at provides. token_hash follows the
			// same "never store the raw token" reasoning as password_resets.
			if _, err := tx.Exec("ALTER TABLE users ADD COLUMN pending_email TEXT"); err != nil {
				return fmt.Errorf("failed to add pending_email: %w", err)
			}
			if _, err := tx.Exec("ALTER TABLE users ADD COLUMN pending_email_token_hash TEXT"); err != nil {
				return fmt.Errorf("failed to add pending_email_token_hash: %w", err)
			}
			ddl := "ALTER TABLE users ADD COLUMN pending_email_expires_at DATETIME"
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				ddl = pgSchema(ddl)
			}
			if _, err := tx.Exec(ddl); err != nil {
				return fmt.Errorf("failed to add pending_email_expires_at: %w", err)
			}
			if _, err := tx.Exec("CREATE INDEX idx_users_pending_email_token_hash ON users(pending_email_token_hash)"); err != nil {
				return fmt.Errorf("failed to create pending_email_token_hash index: %w", err)
			}
			return nil
		},
	},
	{
		version:     11,
		description: "add_billing_to_teams",
		up: func(tx sqlExecer) error {
			// plan moves from users (one flat value) to teams: product-memory
			// 08.5 item G1 — billing is per-team/seat-based ($19/user/month),
			// and a user can belong to many teams (their personal team plus
			// any they're invited into), so "the user's plan" was never a
			// coherent single value once billing became real. users.plan is
			// left in place (harmless, unused going forward) rather than
			// dropped — SQLite's DROP COLUMN support is version-dependent and
			// this column carries no data worth preserving or risk worth
			// taking to remove.
			//
			// No inline CHECK (unlike users.plan's CREATE-TABLE-time one) —
			// no existing migration in this file has proven ALTER TABLE ADD
			// COLUMN ... CHECK across both the SQLite and Postgres paths this
			// package supports, and validity is already enforced in Go at
			// every write site, so it's not worth being the first to try.
			if _, err := tx.Exec("ALTER TABLE teams ADD COLUMN plan TEXT NOT NULL DEFAULT 'FREE'"); err != nil {
				return fmt.Errorf("failed to add plan: %w", err)
			}
			// billing_provider is nullable and currently only ever "paddle"
			// when set — see the BillingProvider interface in billing.go.
			// Kept as a plain string column (not an enum/CHECK) specifically
			// so a future direct-integrator provider (Stripe once invited,
			// Razorpay, ...) is a new value, not a schema change.
			if _, err := tx.Exec("ALTER TABLE teams ADD COLUMN billing_provider TEXT"); err != nil {
				return fmt.Errorf("failed to add billing_provider: %w", err)
			}
			if _, err := tx.Exec("ALTER TABLE teams ADD COLUMN billing_customer_id TEXT"); err != nil {
				return fmt.Errorf("failed to add billing_customer_id: %w", err)
			}
			if _, err := tx.Exec("ALTER TABLE teams ADD COLUMN billing_subscription_id TEXT"); err != nil {
				return fmt.Errorf("failed to add billing_subscription_id: %w", err)
			}
			// subscription_status is the provider's own status string
			// (Paddle: active/trialing/past_due/paused/canceled), not
			// normalized further — the only thing this app currently branches
			// on is plan (FREE vs PRO/ENTERPRISE), set directly from the
			// webhook handler's event-type switch, not derived from this
			// column. This exists for display (the account's billing card)
			// and so dunning/paused state isn't silently indistinguishable
			// from active.
			if _, err := tx.Exec("ALTER TABLE teams ADD COLUMN subscription_status TEXT"); err != nil {
				return fmt.Errorf("failed to add subscription_status: %w", err)
			}
			if _, err := tx.Exec("ALTER TABLE teams ADD COLUMN subscription_seats INTEGER"); err != nil {
				return fmt.Errorf("failed to add subscription_seats: %w", err)
			}
			periodEndDDL := "ALTER TABLE teams ADD COLUMN current_period_end DATETIME"
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				periodEndDDL = pgSchema(periodEndDDL)
			}
			if _, err := tx.Exec(periodEndDDL); err != nil {
				return fmt.Errorf("failed to add current_period_end: %w", err)
			}
			if _, err := tx.Exec("CREATE INDEX idx_teams_billing_customer_id ON teams(billing_customer_id)"); err != nil {
				return fmt.Errorf("failed to create billing_customer_id index: %w", err)
			}

			// Paddle retries a webhook delivery (same event_id) until it gets
			// a 2xx or its retry budget is exhausted, so every handler must
			// be idempotent. Subscription/customer updates are naturally
			// idempotent (UPSERT-by-resource-id via plain UPDATEs keyed on
			// billing_subscription_id), but there's no resource id to key a
			// plan *change* UPDATE on in the same way — so this ledger exists
			// specifically to dedupe on the one thing every Paddle event
			// guarantees: event_id.
			ledgerDDL := `CREATE TABLE billing_webhook_events (
				event_id TEXT PRIMARY KEY,
				provider TEXT NOT NULL,
				event_type TEXT NOT NULL,
				processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				ledgerDDL = pgSchema(ledgerDDL)
			}
			if _, err := tx.Exec(ledgerDDL); err != nil {
				return fmt.Errorf("failed to create billing_webhook_events: %w", err)
			}
			return nil
		},
	},
	{
		version:     12,
		description: "add_tier_to_templates",
		up: func(tx sqlExecer) error {
			// Real Pro gating for templates (product-memory 08.5 item F1),
			// replacing the catalog's old decorative per-id-hash "Pro" badge.
			// Plain TEXT, no inline CHECK — same reasoning as migration 11's
			// teams.plan: validity is enforced in Go and no migration here has
			// proven ALTER ... ADD COLUMN ... CHECK on both backends.
			if _, err := tx.Exec("ALTER TABLE templates ADD COLUMN tier TEXT NOT NULL DEFAULT 'FREE'"); err != nil {
				return fmt.Errorf("failed to add tier: %w", err)
			}
			// Databases seeded before tiers existed: apply the same curated
			// list the seeder uses for fresh ones (proSeedTemplateTitles).
			for title := range proSeedTemplateTitles {
				if _, err := tx.Exec("UPDATE templates SET tier = 'PRO' WHERE author_user_id = 'whiparc_official' AND title = ?", title); err != nil {
					return fmt.Errorf("failed to mark %q PRO: %w", title, err)
				}
			}
			return nil
		},
	},
	{
		version:     13,
		description: "add_user_avatars_table",
		up: func(tx sqlExecer) error {
			// Uploaded avatar bytes live in their own table so ordinary user
			// queries never drag a BLOB along. `key` is the random public
			// identifier served at /api/avatars/{key} and is regenerated on
			// every upload. FK cascade means deleting a user (account
			// deletion) removes their avatar with no extra code path.
			ddl := `CREATE TABLE user_avatars (
				user_id TEXT PRIMARY KEY,
				key TEXT UNIQUE NOT NULL,
				mime TEXT NOT NULL,
				data BLOB NOT NULL,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			)`
			if t, ok := tx.(*dbTx); ok && t.backend == "postgres" {
				ddl = pgSchema(ddl)
			}
			if _, err := tx.Exec(ddl); err != nil {
				return fmt.Errorf("failed to create user_avatars: %w", err)
			}
			// Before this migration avatar_url could only ever be a
			// user-pasted external URL. Those are the exact thing the upload
			// flow replaces (every viewer's browser fetched an arbitrary
			// third-party host), so they are cleared; users fall back to
			// initials until they upload an image.
			if _, err := tx.Exec("UPDATE users SET avatar_url = NULL WHERE avatar_url IS NOT NULL"); err != nil {
				return fmt.Errorf("failed to clear legacy external avatar URLs: %w", err)
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
