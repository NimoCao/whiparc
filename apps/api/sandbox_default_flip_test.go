package main

// Covers the pure date-logic pieces of Phase 3's default-flip gating
// (obsidian_memory/08.4) — sandboxAgentDefaultCutoff/sandboxAgentGracePeriodEnd
// touch only env vars, not the package-level `db`, so they're safe to unit
// test in isolation. sandboxDeployGatedForFreeTier/handleGetSandboxMigrationStatus
// query `users`/paired_agents and stay manual-verification-only, same
// established reason as every other apps/api handler in this rollout (no
// test-friendly DB bootstrap in this package).

import "testing"

func TestSandboxAgentDefaultEnabledRequiresBothFlags(t *testing.T) {
	cases := []struct {
		beta, def string
		want      bool
	}{
		{"true", "true", true},
		{"true", "false", false},
		{"false", "true", false},
		{"", "", false},
	}
	for _, c := range cases {
		t.Setenv("SANDBOX_AGENT_BETA", c.beta)
		t.Setenv("SANDBOX_AGENT_DEFAULT", c.def)
		if got := sandboxAgentDefaultEnabled(); got != c.want {
			t.Errorf("sandboxAgentDefaultEnabled() with BETA=%q DEFAULT=%q = %v, want %v", c.beta, c.def, got, c.want)
		}
	}
}

func TestSandboxAgentDefaultCutoffUnsetOrInvalid(t *testing.T) {
	t.Setenv("SANDBOX_AGENT_DEFAULT_CUTOFF", "")
	if _, ok := sandboxAgentDefaultCutoff(); ok {
		t.Error("sandboxAgentDefaultCutoff() with unset env, want ok=false")
	}

	t.Setenv("SANDBOX_AGENT_DEFAULT_CUTOFF", "not-a-date")
	if _, ok := sandboxAgentDefaultCutoff(); ok {
		t.Error("sandboxAgentDefaultCutoff() with invalid date, want ok=false")
	}
}

func TestSandboxAgentDefaultCutoffParsesValidDate(t *testing.T) {
	t.Setenv("SANDBOX_AGENT_DEFAULT_CUTOFF", "2026-09-15")
	got, ok := sandboxAgentDefaultCutoff()
	if !ok {
		t.Fatal("sandboxAgentDefaultCutoff() with valid date, want ok=true")
	}
	if got.Format("2006-01-02") != "2026-09-15" {
		t.Errorf("sandboxAgentDefaultCutoff() = %v, want 2026-09-15", got)
	}
}

func TestSandboxAgentGracePeriodEndDefaultsTo30Days(t *testing.T) {
	t.Setenv("SANDBOX_AGENT_GRACE_PERIOD_DAYS", "")
	cutoff, _ := sandboxAgentDefaultCutoff() // zero value fine, only testing the offset
	got := sandboxAgentGracePeriodEnd(cutoff)
	want := cutoff.AddDate(0, 0, 30)
	if !got.Equal(want) {
		t.Errorf("sandboxAgentGracePeriodEnd() with no override = %v, want %v (30-day default)", got, want)
	}
}

func TestSandboxAgentGracePeriodEndRespectsOverride(t *testing.T) {
	t.Setenv("SANDBOX_AGENT_GRACE_PERIOD_DAYS", "10")
	cutoff, _ := sandboxAgentDefaultCutoff()
	got := sandboxAgentGracePeriodEnd(cutoff)
	want := cutoff.AddDate(0, 0, 10)
	if !got.Equal(want) {
		t.Errorf("sandboxAgentGracePeriodEnd() with SANDBOX_AGENT_GRACE_PERIOD_DAYS=10 = %v, want %v", got, want)
	}
}

func TestSandboxAgentGracePeriodEndIgnoresInvalidOverride(t *testing.T) {
	t.Setenv("SANDBOX_AGENT_GRACE_PERIOD_DAYS", "not-a-number")
	cutoff, _ := sandboxAgentDefaultCutoff()
	got := sandboxAgentGracePeriodEnd(cutoff)
	want := cutoff.AddDate(0, 0, 30)
	if !got.Equal(want) {
		t.Errorf("sandboxAgentGracePeriodEnd() with invalid override = %v, want the 30-day default %v", got, want)
	}
}

func TestSandboxDeployGatedForFreeTierShortCircuitsWithoutDBLookup(t *testing.T) {
	// These cases all resolve to false via the two env-only checks (gating
	// enabled, cutoff reached) before the function ever reaches
	// teamPlanForProject's DB lookup, so they're safe to exercise with db
	// still nil (package main's zero-value default outside of main() actually
	// running). Since G1 moved plan from a parameter to a DB-resolved value
	// (teams.plan via the project's team — see teamPlanForProject), there's
	// no longer a pure "PRO plan short-circuits" case to test here the same
	// way: resolving plan at all now requires the DB call this test exists to
	// avoid, so that case moved to manual verification along with the rest of
	// this function's DB-touching behavior (see the file-level comment).
	t.Setenv("SANDBOX_AGENT_BETA", "true")
	t.Setenv("SANDBOX_AGENT_DEFAULT", "true")
	t.Setenv("SANDBOX_AGENT_DEFAULT_CUTOFF", "2099-01-01") // far future — "now" is always before it

	t.Setenv("SANDBOX_AGENT_DEFAULT", "false")
	if got := sandboxDeployGatedForFreeTier("user-1", "project-1"); got {
		t.Error("sandboxDeployGatedForFreeTier() with gating disabled, want false")
	}

	t.Setenv("SANDBOX_AGENT_DEFAULT", "true")
	if got := sandboxDeployGatedForFreeTier("user-1", "project-1"); got {
		t.Error("sandboxDeployGatedForFreeTier() before the cutoff date has arrived, want false")
	}
}
