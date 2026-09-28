package main

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRunMigrationsAppliesOnceAndIsIdempotent(t *testing.T) {
	rawDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer rawDB.Close()

	testDB := &dbHandle{DB: rawDB, backend: "sqlite"}
	if _, err := testDB.Exec(sqliteSchemaSQL); err != nil {
		t.Fatalf("create schema: %v", err)
	}

	if err := runMigrations(testDB); err != nil {
		t.Fatalf("first runMigrations: %v", err)
	}

	var count int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = 1").Scan(&count); err != nil {
		t.Fatalf("query schema_migrations v1: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected migration 1 to be recorded once, got count=%d", count)
	}

	var count2 int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = 2").Scan(&count2); err != nil {
		t.Fatalf("query schema_migrations v2: %v", err)
	}
	if count2 != 1 {
		t.Fatalf("expected migration 2 to be recorded once, got count=%d", count2)
	}

	// Verify columns were added to users table
	var emailVerified bool
	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name) VALUES ('u_test', 'test@test.com', 'hash', 'Test')"); err != nil {
		t.Fatalf("failed to insert test user after migration: %v", err)
	}
	if err := testDB.QueryRow("SELECT email_verified FROM users WHERE id = 'u_test'").Scan(&emailVerified); err != nil {
		t.Fatalf("failed to query email_verified from users: %v", err)
	}

	// A second run against an already-migrated database (the baseline case
	// for every pre-existing environment, including production) must be a
	// no-op rather than a duplicate-insert error.
	if err := runMigrations(testDB); err != nil {
		t.Fatalf("second runMigrations: %v", err)
	}
	if err := testDB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = 2").Scan(&count2); err != nil {
		t.Fatalf("query schema_migrations after rerun: %v", err)
	}
	if count2 != 1 {
		t.Fatalf("expected migration 2 still recorded exactly once after rerun, got count=%d", count2)
	}

	var count3 int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = 3").Scan(&count3); err != nil {
		t.Fatalf("query schema_migrations v3: %v", err)
	}
	if count3 != 1 {
		t.Fatalf("expected migration 3 to be recorded once, got count=%d", count3)
	}

	// run_type/target must exist and accept NULL for a pre-migration-style
	// insert (only the columns that existed before version 3 shipped) —
	// legacy rows must keep deserializing rather than erroring.
	if _, err := testDB.Exec("INSERT INTO pipeline_runs (id, status, logs, canvas) VALUES ('r_legacy', 'SUCCESS', '', '{}')"); err != nil {
		t.Fatalf("failed to insert legacy-shaped pipeline_runs row: %v", err)
	}
	var runType, target sql.NullString
	if err := testDB.QueryRow("SELECT run_type, target FROM pipeline_runs WHERE id = 'r_legacy'").Scan(&runType, &target); err != nil {
		t.Fatalf("failed to query run_type/target for legacy row: %v", err)
	}
	if runType.Valid || target.Valid {
		t.Fatalf("expected legacy row's run_type/target to be NULL, got runType=%v target=%v", runType, target)
	}

	// A new-shaped insert must round-trip real values.
	if _, err := testDB.Exec("INSERT INTO pipeline_runs (id, status, logs, canvas, run_type, target) VALUES ('r_new', 'SUCCESS', '', '{}', 'apply', 'AWS · us-east-1')"); err != nil {
		t.Fatalf("failed to insert new-shaped pipeline_runs row: %v", err)
	}
	if err := testDB.QueryRow("SELECT run_type, target FROM pipeline_runs WHERE id = 'r_new'").Scan(&runType, &target); err != nil {
		t.Fatalf("failed to query run_type/target for new row: %v", err)
	}
	if !runType.Valid || runType.String != "apply" || !target.Valid || target.String != "AWS · us-east-1" {
		t.Fatalf("expected run_type=apply target='AWS · us-east-1', got runType=%v target=%v", runType, target)
	}

	var count4 int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = 4").Scan(&count4); err != nil {
		t.Fatalf("query schema_migrations v4: %v", err)
	}
	if count4 != 1 {
		t.Fatalf("expected migration 4 to be recorded once, got count=%d", count4)
	}

	// onboarding_dismissed_at must default to NULL (checklist still shows)
	// and accept a real timestamp once dismissed.
	var dismissedAt sql.NullString
	if err := testDB.QueryRow("SELECT onboarding_dismissed_at FROM users WHERE id = 'u_test'").Scan(&dismissedAt); err != nil {
		t.Fatalf("failed to query onboarding_dismissed_at: %v", err)
	}
	if dismissedAt.Valid {
		t.Fatalf("expected onboarding_dismissed_at to default to NULL, got %v", dismissedAt)
	}
	if _, err := testDB.Exec("UPDATE users SET onboarding_dismissed_at = datetime('now') WHERE id = 'u_test'"); err != nil {
		t.Fatalf("failed to set onboarding_dismissed_at: %v", err)
	}
	if err := testDB.QueryRow("SELECT onboarding_dismissed_at FROM users WHERE id = 'u_test'").Scan(&dismissedAt); err != nil {
		t.Fatalf("failed to query onboarding_dismissed_at after update: %v", err)
	}
	if !dismissedAt.Valid {
		t.Fatalf("expected onboarding_dismissed_at to be set after dismissal")
	}

	var count5 int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = 5").Scan(&count5); err != nil {
		t.Fatalf("query schema_migrations v5: %v", err)
	}
	if count5 != 1 {
		t.Fatalf("expected migration 5 to be recorded once, got count=%d", count5)
	}

	// activity_events must accept a full row and round-trip it.
	if _, err := testDB.Exec(
		"INSERT INTO activity_events (id, team_id, project_id, actor_id, kind, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
		"evt_test", "team_1", "proj_1", "u_test", "project.created", `{"name":"demo"}`,
	); err != nil {
		t.Fatalf("failed to insert activity_events row: %v", err)
	}
	var kind, payload string
	if err := testDB.QueryRow("SELECT kind, payload_json FROM activity_events WHERE id = 'evt_test'").Scan(&kind, &payload); err != nil {
		t.Fatalf("failed to query activity_events: %v", err)
	}
	if kind != "project.created" || payload != `{"name":"demo"}` {
		t.Fatalf("unexpected activity_events round-trip: kind=%q payload=%q", kind, payload)
	}
}
