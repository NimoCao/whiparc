package main

import "testing"

func seedBillingTeams(t *testing.T) func() {
	t.Helper()
	oldDB := db
	testDB := setupAuthTestDB(t)
	testDB.SetMaxOpenConns(1)
	db = testDB
	for _, q := range []string{
		"INSERT INTO users (id, email, name, email_verified) VALUES ('u1', 'u1@test.com', 'U', TRUE)",
		"INSERT INTO teams (id, name, slug, owner_id) VALUES ('t_new', 'New', 'new', 'u1')",
		"INSERT INTO teams (id, name, slug, owner_id, plan, billing_provider, billing_customer_id, billing_subscription_id, subscription_status) VALUES ('t_live', 'Live', 'live', 'u1', 'PRO', 'paddle', 'ctm_1', 'sub_live', 'active')",
		"INSERT INTO teams (id, name, slug, owner_id, plan, billing_provider, billing_customer_id, billing_subscription_id, subscription_status) VALUES ('t_dead', 'Dead', 'dead', 'u1', 'FREE', 'paddle', 'ctm_1', 'sub_old', 'canceled')",
	} {
		if _, err := testDB.Exec(q); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	return func() {
		testDB.Close()
		db = oldDB
	}
}

func TestBillingEventResolvesByStoredSubscriptionBeforeCustomData(t *testing.T) {
	defer seedBillingTeams(t)()

	// A later event for t_live's subscription resolves by the id this server
	// stored, even when (spoofed or stale) custom_data names another team.
	got, err := resolveTeamIDForBillingEvent(&BillingEvent{EventID: "e1", SubscriptionID: "sub_live", TeamID: "t_new"})
	if err != nil || got != "t_live" {
		t.Fatalf("expected t_live via stored subscription id, got %q err=%v", got, err)
	}
}

func TestBillingEventFirstBindingUsesCustomData(t *testing.T) {
	defer seedBillingTeams(t)()

	got, err := resolveTeamIDForBillingEvent(&BillingEvent{EventID: "e2", SubscriptionID: "sub_fresh", TeamID: "t_new"})
	if err != nil || got != "t_new" {
		t.Fatalf("expected first-time binding to t_new, got %q err=%v", got, err)
	}
	// A team whose previous subscription is dead may take a new one.
	got, err = resolveTeamIDForBillingEvent(&BillingEvent{EventID: "e3", SubscriptionID: "sub_fresh2", TeamID: "t_dead"})
	if err != nil || got != "t_dead" {
		t.Fatalf("a canceled team should accept a replacement subscription, got %q err=%v", got, err)
	}
}

func TestBillingEventCannotRebindTeamWithLiveSubscription(t *testing.T) {
	defer seedBillingTeams(t)()

	// Someone's payment (sub_attacker) claims t_live via client-supplied
	// custom_data while t_live already has an active, different subscription.
	if got, err := resolveTeamIDForBillingEvent(&BillingEvent{EventID: "e4", SubscriptionID: "sub_attacker", TeamID: "t_live"}); err == nil {
		t.Fatalf("must refuse to rebind a team with a live subscription, resolved %q", got)
	}
}

func TestBillingEventDoesNotMatchByCustomerID(t *testing.T) {
	defer seedBillingTeams(t)()

	// ctm_1 owns subscriptions on two teams; with no subscription match and
	// no custom_data there must be no guessing between them.
	if got, err := resolveTeamIDForBillingEvent(&BillingEvent{EventID: "e5", SubscriptionID: "sub_unknown", CustomerID: "ctm_1"}); err == nil {
		t.Fatalf("customer id alone must not resolve a team, got %q", got)
	}
}
