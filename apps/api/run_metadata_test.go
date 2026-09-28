package main

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestDeriveRunTarget(t *testing.T) {
	cases := []struct {
		name   string
		canvas string
		want   string
	}{
		{"aws with region", `{"nodes":[{"data":{"environment":"aws","region":"us-east-1"}}]}`, "AWS · us-east-1"},
		{"aws without region", `{"nodes":[{"data":{"environment":"aws"}}]}`, "AWS"},
		{"gcp with zone", `{"nodes":[{"data":{"environment":"gcp","gcpZone":"us-central1-a"}}]}`, "GCP · us-central1-a"},
		{"gcp without zone", `{"nodes":[{"data":{"environment":"gcp"}}]}`, "GCP"},
		{"other environment", `{"nodes":[{"data":{"environment":"azure"}}]}`, "AZURE"},
		{"first node wins", `{"nodes":[{"data":{}},{"data":{"environment":"aws","region":"eu-west-1"}}]}`, "AWS · eu-west-1"},
		{"no environment anywhere", `{"nodes":[{"data":{}}]}`, ""},
		{"no nodes", `{"nodes":[]}`, ""},
		{"invalid json", `not json`, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := deriveRunTarget(c.canvas); got != c.want {
				t.Errorf("deriveRunTarget(%q) = %q, want %q", c.canvas, got, c.want)
			}
		})
	}
}

func TestNullIfEmpty(t *testing.T) {
	if got := nullIfEmpty(""); got != nil {
		t.Errorf("nullIfEmpty(\"\") = %v, want nil", got)
	}
	if got := nullIfEmpty("AWS"); got != "AWS" {
		t.Errorf("nullIfEmpty(\"AWS\") = %v, want \"AWS\"", got)
	}
}

// TestRunsWithTriggeredByJoin exercises the actual LEFT JOIN query and
// scanPipelineRun against a migrated in-memory database, covering both a
// legacy row (no user_id, pre-dates run_type/target) and a new row with a
// real triggering user — the two shapes handleGetRuns/handleGetRunByID must
// both render correctly (obsidian_memory/08.6 section 2.3).
func TestRunsWithTriggeredByJoin(t *testing.T) {
	rawDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer rawDB.Close()

	testDB := &dbHandle{DB: rawDB, backend: "sqlite"}
	if _, err := testDB.Exec(sqliteSchemaSQL); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	if _, err := testDB.Exec("ALTER TABLE pipeline_runs ADD COLUMN project_id TEXT"); err != nil {
		t.Fatalf("add project_id: %v", err)
	}
	if _, err := testDB.Exec("ALTER TABLE pipeline_runs ADD COLUMN user_id TEXT"); err != nil {
		t.Fatalf("add user_id: %v", err)
	}
	if err := runMigrations(testDB); err != nil {
		t.Fatalf("runMigrations: %v", err)
	}

	if _, err := testDB.Exec("INSERT INTO users (id, email, password_hash, name) VALUES ('u1', 'a@b.com', 'hash', 'Ada')"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO pipeline_runs (id, project_id, user_id, status, logs, canvas, run_type, target) VALUES ('r_new', 'p1', 'u1', 'SUCCESS', '', '{}', 'apply', 'AWS')"); err != nil {
		t.Fatalf("insert new run: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO pipeline_runs (id, project_id, status, logs, canvas) VALUES ('r_legacy', 'p1', 'PENDING', '', '{}')"); err != nil {
		t.Fatalf("insert legacy run: %v", err)
	}

	rows, err := testDB.Query(runsWithTriggeredByQuery+" WHERE pr.project_id = ? ORDER BY pr.id", "p1")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()

	var runs []PipelineRun
	for rows.Next() {
		run, err := scanPipelineRun(rows)
		if err != nil {
			t.Fatalf("scan: %v", err)
		}
		runs = append(runs, run)
	}
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}

	legacy, newRun := runs[0], runs[1]
	if legacy.ID != "r_legacy" || legacy.RunType != nil || legacy.Target != nil || legacy.TriggeredBy != nil {
		t.Errorf("expected legacy run's runType/target/triggeredBy all nil, got %+v", legacy)
	}
	if newRun.ID != "r_new" || newRun.RunType == nil || *newRun.RunType != "apply" ||
		newRun.Target == nil || *newRun.Target != "AWS" ||
		newRun.TriggeredBy == nil || newRun.TriggeredBy.Name != "Ada" || newRun.TriggeredBy.Email != "a@b.com" {
		t.Errorf("unexpected new run fields: %+v", newRun)
	}

	// Regression guard: scanPipelineRun used to scan created_at/updated_at
	// into a string and re-parse it with a fixed "2006-01-02 15:04:05"
	// layout, but modernc.org/sqlite returns a DATETIME column's value
	// already as RFC3339 ("...Z") when the destination is a string — the
	// parse failed silently (error discarded) on every row, leaving
	// CreatedAt/UpdatedAt at time.Time's zero value (year 1), which the
	// dashboard/runs pages then rendered as "739880d ago". Scanning
	// straight into time.Time (current code) avoids the mismatch entirely.
	if newRun.CreatedAt.Year() < 2000 {
		t.Errorf("expected a real CreatedAt, got zero-ish value: %v", newRun.CreatedAt)
	}
}
