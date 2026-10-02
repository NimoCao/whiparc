package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// BillingProvider is the swappable abstraction product-memory 08.5 item G1
// calls for: a small interface covering checkout-adjacent needs (webhook
// verification/normalization, customer-portal links, seat-quantity updates),
// with PaddleProvider as the only implementation for now. Checkout itself
// isn't part of this interface — it happens entirely client-side via
// Paddle.js (see TeamPageV2.tsx), so there's no "start checkout" method to
// abstract yet. The reason this interface exists at all: when whiparc has a
// registered business entity and a GSTIN, adding a direct integrator
// (Stripe once invited, or Razorpay for India-based hosted customers) should
// be a second implementation behind this same interface and a per-team
// billing_provider value, not a rewrite.
type BillingProvider interface {
	// Name is the value stored in teams.billing_provider for any team whose
	// subscription this provider created.
	Name() string
	// VerifyAndParseWebhook checks the inbound request's signature against
	// the raw body and, only if it verifies, returns the normalized event.
	VerifyAndParseWebhook(rawBody []byte, signatureHeader string) (*BillingEvent, error)
	// CustomerPortalURL mints a fresh, one-time, time-limited link to the
	// provider's hosted self-service billing UI for this customer. Never
	// cache the result.
	CustomerPortalURL(customerID string) (string, error)
	// UpdateSeats changes the billed quantity on an existing subscription —
	// used to keep billing in sync with team_members as people are invited
	// or removed. Best-effort from the caller's side: a failure here should
	// log and continue, not block the membership change that triggered it.
	UpdateSeats(subscriptionID string, seats int) error
}

// BillingEvent is a provider webhook event normalized to the fields this
// app actually acts on. TeamID is populated from the checkout's custom_data
// (see Paddle.Checkout.open's customData in TeamPageV2.tsx) when the
// delivery carries it — reliably true for the subscription.created that
// follows a checkout, not guaranteed for every later event type, which is
// why resolveTeamIDForBillingEvent also falls back to matching on
// SubscriptionID/CustomerID against what an earlier event already stored.
type BillingEvent struct {
	EventID          string
	EventType        string
	TeamID           string
	CustomerID       string
	SubscriptionID   string
	Status           string // the provider's own status string, stored as-is in teams.subscription_status
	Seats            int    // 0 if not applicable/unknown
	CurrentPeriodEnd time.Time
}

// grantsProAccess is the one piece of business logic this app layers on top
// of a provider's native subscription status: which statuses count as "this
// team gets Pro." Deliberately narrow — past_due/paused revert the team to
// FREE (not a silent "they're still Pro while card details get sorted out")
// while preserving subscription_status/billing_subscription_id so the
// billing UI can show *why* and link to the portal to fix payment, rather
// than looking identical to a team that never subscribed.
func grantsProAccess(status string) bool {
	return status == "active" || status == "trialing"
}

// --- Paddle implementation ---

type PaddleProvider struct {
	apiKey        string
	webhookSecret string
	baseURL       string
	client        *http.Client
}

// NewPaddleProvider reads its config from env; an empty apiKey/webhookSecret
// means billing isn't configured yet (fine for local dev — see
// .env.example) and every method below fails loudly rather than silently
// no-opping, so a misconfiguration surfaces as a clear error instead of a
// webhook that looks accepted but did nothing.
func NewPaddleProvider() *PaddleProvider {
	baseURL := "https://api.paddle.com"
	if strings.EqualFold(os.Getenv("PADDLE_ENVIRONMENT"), "sandbox") {
		baseURL = "https://sandbox-api.paddle.com"
	}
	return &PaddleProvider{
		apiKey:        os.Getenv("PADDLE_API_KEY"),
		webhookSecret: os.Getenv("PADDLE_WEBHOOK_SECRET"),
		baseURL:       baseURL,
		client:        &http.Client{Timeout: 10 * time.Second},
	}
}

func (p *PaddleProvider) Name() string { return "paddle" }

// parsePaddleSignatureHeader splits Paddle's "ts=<unix>;h1=<hex>" header
// format into its two components.
func parsePaddleSignatureHeader(header string) (ts, h1 string, err error) {
	for _, part := range strings.Split(header, ";") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch strings.TrimSpace(kv[0]) {
		case "ts":
			ts = strings.TrimSpace(kv[1])
		case "h1":
			h1 = strings.TrimSpace(kv[1])
		}
	}
	if ts == "" || h1 == "" {
		return "", "", fmt.Errorf("malformed Paddle-Signature header")
	}
	return ts, h1, nil
}

type paddleWebhookEnvelope struct {
	EventID   string          `json:"event_id"`
	EventType string          `json:"event_type"`
	Data      json.RawMessage `json:"data"`
}

type paddleSubscriptionData struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	CustomerID string `json:"customer_id"`
	Items      []struct {
		Quantity int `json:"quantity"`
	} `json:"items"`
	CurrentBillingPeriod *struct {
		EndsAt string `json:"ends_at"`
	} `json:"current_billing_period"`
	CustomData map[string]interface{} `json:"custom_data"`
}

// VerifyAndParseWebhook implements the algorithm Paddle documents at
// developer.paddle.com/webhooks/about/signature-verification: HMAC-SHA256 of
// "{ts}:{raw_body}" keyed with the notification destination's secret,
// hex-encoded, compared against the header's h1. Every non-2xx response from
// the caller (main.go's handlePaddleWebhook) gets retried by Paddle on the
// same budget regardless of *why* it failed, so this deliberately returns
// one generic error for every failure mode (malformed header, bad
// signature, unparseable body) rather than trying to distinguish them —
// see the webhooks skill's "common pitfalls" for why splitting that doesn't
// actually buy anything.
func (p *PaddleProvider) VerifyAndParseWebhook(rawBody []byte, signatureHeader string) (*BillingEvent, error) {
	if p.webhookSecret == "" {
		return nil, fmt.Errorf("PADDLE_WEBHOOK_SECRET is not configured")
	}
	ts, h1, err := parsePaddleSignatureHeader(signatureHeader)
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, []byte(p.webhookSecret))
	mac.Write([]byte(ts + ":" + string(rawBody)))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(h1)) {
		return nil, fmt.Errorf("webhook signature verification failed")
	}

	var env paddleWebhookEnvelope
	if err := json.Unmarshal(rawBody, &env); err != nil {
		return nil, fmt.Errorf("failed to parse webhook envelope: %w", err)
	}

	ev := &BillingEvent{EventID: env.EventID, EventType: env.EventType}

	switch {
	case strings.HasPrefix(env.EventType, "subscription."):
		var sub paddleSubscriptionData
		if err := json.Unmarshal(env.Data, &sub); err != nil {
			return nil, fmt.Errorf("failed to parse subscription payload: %w", err)
		}
		ev.CustomerID = sub.CustomerID
		ev.SubscriptionID = sub.ID
		ev.Status = sub.Status
		if len(sub.Items) > 0 {
			ev.Seats = sub.Items[0].Quantity
		}
		if sub.CurrentBillingPeriod != nil {
			if t, err := time.Parse(time.RFC3339, sub.CurrentBillingPeriod.EndsAt); err == nil {
				ev.CurrentPeriodEnd = t
			}
		}
		if teamID, ok := sub.CustomData["team_id"].(string); ok {
			ev.TeamID = teamID
		}
	default:
		// Events this app doesn't act on yet (transaction.*, customer.*) —
		// a no-op, not an error, same as the webhooks skill's default case.
	}

	return ev, nil
}

type paddlePortalSessionResponse struct {
	Data struct {
		URLs struct {
			General struct {
				Overview string `json:"overview"`
			} `json:"general"`
		} `json:"urls"`
	} `json:"data"`
}

func (p *PaddleProvider) doRequest(method, path string, body interface{}) ([]byte, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("PADDLE_API_KEY is not configured")
	}
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to encode request body: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, p.baseURL+path, reqBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("paddle api request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read paddle api response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("paddle api returned status %d: %s", resp.StatusCode, string(respBody))
	}
	return respBody, nil
}

// CustomerPortalURL — POST /customers/{customer_id}/portal-sessions, no body
// required. Returns data.urls.general.overview (see
// developer.paddle.com/build/customers/integrate-customer-portal).
func (p *PaddleProvider) CustomerPortalURL(customerID string) (string, error) {
	respBody, err := p.doRequest(http.MethodPost, "/customers/"+customerID+"/portal-sessions", nil)
	if err != nil {
		return "", err
	}
	var parsed paddlePortalSessionResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("failed to parse portal session response: %w", err)
	}
	if parsed.Data.URLs.General.Overview == "" {
		return "", fmt.Errorf("paddle portal session response had no overview URL")
	}
	return parsed.Data.URLs.General.Overview, nil
}

// UpdateSeats — PATCH /subscriptions/{subscription_id} with the single Pro
// seat price and the new quantity. prorated_immediately matches the
// product's stated billing shape ($19/user/month): adding a seat mid-cycle
// bills the prorated difference now rather than silently waiting for the
// next renewal.
func (p *PaddleProvider) UpdateSeats(subscriptionID string, seats int) error {
	priceID := os.Getenv("PADDLE_PRICE_ID_PRO")
	if priceID == "" {
		return fmt.Errorf("PADDLE_PRICE_ID_PRO is not configured")
	}
	body := map[string]interface{}{
		"items": []map[string]interface{}{
			{"price_id": priceID, "quantity": seats},
		},
		"proration_billing_mode": "prorated_immediately",
	}
	_, err := p.doRequest(http.MethodPatch, "/subscriptions/"+subscriptionID, body)
	return err
}

// --- HTTP handlers ---

// resolveTeamIDForBillingEvent maps an inbound event to the internal team
// it's about. custom_data.team_id (only reliably present on the
// subscription.created that follows checkout) is tried first; later events
// for the same subscription fall back to matching on billing_subscription_id
// or billing_customer_id against whatever an earlier event already stored —
// Paddle doesn't guarantee custom_data on every event type for a
// subscription, only that it's copied onto the subscription at creation
// time, not necessarily echoed in every subsequent webhook body.
func resolveTeamIDForBillingEvent(ev *BillingEvent) (string, error) {
	if ev.TeamID != "" {
		var id string
		if err := db.QueryRow("SELECT id FROM teams WHERE id = ?", ev.TeamID).Scan(&id); err == nil {
			return id, nil
		}
	}
	if ev.SubscriptionID != "" {
		var id string
		if err := db.QueryRow("SELECT id FROM teams WHERE billing_subscription_id = ?", ev.SubscriptionID).Scan(&id); err == nil {
			return id, nil
		}
	}
	if ev.CustomerID != "" {
		var id string
		if err := db.QueryRow("SELECT id FROM teams WHERE billing_customer_id = ?", ev.CustomerID).Scan(&id); err == nil {
			return id, nil
		}
	}
	return "", fmt.Errorf("could not resolve a team for billing event %s (type=%s team_id=%q subscription_id=%q customer_id=%q)",
		ev.EventID, ev.EventType, ev.TeamID, ev.SubscriptionID, ev.CustomerID)
}

// POST /api/billing/webhook — public (Paddle calls this directly, no user
// session). Verify, dedupe, apply, ack. Per the webhooks skill: only a 2xx
// marks a delivery handled, so every failure path below must return
// non-2xx, never swallow an error into a 200.
func handlePaddleWebhook(w http.ResponseWriter, r *http.Request) {
	signature := r.Header.Get("Paddle-Signature")
	rawBody, err := io.ReadAll(r.Body)
	if err != nil || signature == "" || len(rawBody) == 0 {
		http.Error(w, "Missing signature or body", http.StatusBadRequest)
		return
	}

	ev, err := billingProvider.VerifyAndParseWebhook(rawBody, signature)
	if err != nil {
		log.Printf("[BILLING] Webhook verification failed: %v\n", err)
		http.Error(w, "Verification failed", http.StatusUnauthorized)
		return
	}

	// Idempotency: Paddle redelivers the identical event_id until it gets a
	// 2xx. A duplicate is success, not an error — ack it without reapplying.
	var exists string
	if err := db.QueryRow("SELECT event_id FROM billing_webhook_events WHERE event_id = ?", ev.EventID).Scan(&exists); err == nil {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]bool{"received": true})
		return
	} else if err != sql.ErrNoRows {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if strings.HasPrefix(ev.EventType, "subscription.") {
		teamID, err := resolveTeamIDForBillingEvent(ev)
		if err != nil {
			// Can't attribute this event to a team — log and ack anyway.
			// Retrying won't help: the event will never carry more
			// identifying info than it does now, and refusing to ack would
			// burn Paddle's retry budget on an event this app can never
			// resolve. A real integration bug here (e.g. checkout wasn't
			// passing custom_data) needs to be caught by server logs, not
			// an infinite redelivery loop.
			log.Printf("[BILLING] %v\n", err)
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]bool{"received": true})
			return
		}

		plan := "FREE"
		if grantsProAccess(ev.Status) {
			plan = "PRO"
		}
		var periodEnd interface{}
		if !ev.CurrentPeriodEnd.IsZero() {
			periodEnd = ev.CurrentPeriodEnd
		}
		var seats interface{}
		if ev.Seats > 0 {
			seats = ev.Seats
		}
		_, err = db.Exec(
			`UPDATE teams SET plan = ?, billing_provider = ?, billing_customer_id = ?, billing_subscription_id = ?, subscription_status = ?, subscription_seats = ?, current_period_end = ? WHERE id = ?`,
			plan, billingProvider.Name(), ev.CustomerID, ev.SubscriptionID, ev.Status, seats, periodEnd, teamID,
		)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		log.Printf("[BILLING] Applied %s for team %s: plan=%s status=%s seats=%d\n", ev.EventType, teamID, plan, ev.Status, ev.Seats)
	}

	if _, err := db.Exec("INSERT INTO billing_webhook_events (event_id, provider, event_type) VALUES (?, ?, ?)", ev.EventID, billingProvider.Name(), ev.EventType); err != nil {
		log.Printf("[BILLING] Warning: failed to record processed webhook event %s: %v\n", ev.EventID, err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]bool{"received": true})
}

type TeamBillingInfo struct {
	TeamID             string `json:"team_id"`
	Plan               string `json:"plan"`
	BillingProvider    string `json:"billing_provider,omitempty"`
	SubscriptionStatus string `json:"subscription_status,omitempty"`
	Seats              int    `json:"seats,omitempty"`
	MemberCount        int    `json:"member_count"`
	CurrentPeriodEnd   string `json:"current_period_end,omitempty"`
	HasSubscription    bool   `json:"has_subscription"`
	PriceIDPro         string `json:"price_id_pro,omitempty"`
}

// GET /api/teams/{id}/billing — any team member can see the team's own plan
// (matches handleGetTeamCredentials/handleGetTeamRuns's MEMBER-level read
// access); only ADMIN+ can act on it (handleGetBillingPortal, and seat sync
// which has no user-facing endpoint — it's triggered internally by
// membership changes).
func handleGetTeamBilling(w http.ResponseWriter, r *http.Request) {
	teamID := r.PathValue("id")

	var plan string
	var provider, status, subscriptionID sql.NullString
	var seats sql.NullInt64
	var periodEnd sql.NullTime
	err := db.QueryRow(
		"SELECT plan, billing_provider, subscription_status, billing_subscription_id, subscription_seats, current_period_end FROM teams WHERE id = ?",
		teamID,
	).Scan(&plan, &provider, &status, &subscriptionID, &seats, &periodEnd)
	if err == sql.ErrNoRows {
		http.Error(w, "Team not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var memberCount int
	_ = db.QueryRow("SELECT COUNT(*) FROM team_members WHERE team_id = ?", teamID).Scan(&memberCount)

	resp := TeamBillingInfo{
		TeamID:             teamID,
		Plan:               plan,
		BillingProvider:    provider.String,
		SubscriptionStatus: status.String,
		Seats:              int(seats.Int64),
		MemberCount:        memberCount,
		HasSubscription:    subscriptionID.Valid && subscriptionID.String != "",
		PriceIDPro:         os.Getenv("PADDLE_PRICE_ID_PRO"),
	}
	if periodEnd.Valid {
		resp.CurrentPeriodEnd = periodEnd.Time.Format(time.RFC3339)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// POST /api/teams/{id}/billing/portal — mints a fresh customer-portal link.
// customerID is resolved server-side from the team row, never accepted from
// the request, so an ADMIN of one team can never mint a portal URL for a
// customer ID they merely know — same reasoning the customer-portal skill's
// security model calls out.
func handleGetBillingPortal(w http.ResponseWriter, r *http.Request) {
	teamID := r.PathValue("id")

	var customerID sql.NullString
	if err := db.QueryRow("SELECT billing_customer_id FROM teams WHERE id = ?", teamID).Scan(&customerID); err != nil {
		http.Error(w, "Team not found", http.StatusNotFound)
		return
	}
	if !customerID.Valid || customerID.String == "" {
		http.Error(w, "This team doesn't have a billing account yet — upgrade to Pro first", http.StatusBadRequest)
		return
	}

	url, err := billingProvider.CustomerPortalURL(customerID.String)
	if err != nil {
		log.Printf("[BILLING] Failed to create portal session for team %s: %v\n", teamID, err)
		http.Error(w, "Failed to open the billing portal. Please try again shortly.", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"url": url})
}

// syncTeamBillingSeats best-effort pushes a team's current member count to
// its active Paddle subscription, if it has one. Called after team_members
// changes (invite accepted, member removed) — never blocks the request that
// triggered it, since a seat-count sync is a nice-to-have (the next renewal
// would self-correct nothing, actually — Paddle bills whatever quantity is
// currently on the subscription, so this *is* how seats stay accurate, but
// a transient failure here shouldn't turn a successful "member removed" into
// a 500).
func syncTeamBillingSeats(teamID string) {
	if billingProvider == nil {
		return
	}
	var subscriptionID sql.NullString
	if err := db.QueryRow("SELECT billing_subscription_id FROM teams WHERE id = ?", teamID).Scan(&subscriptionID); err != nil {
		return
	}
	if !subscriptionID.Valid || subscriptionID.String == "" {
		return
	}
	var memberCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM team_members WHERE team_id = ?", teamID).Scan(&memberCount); err != nil {
		log.Printf("[BILLING] Failed to count members for seat sync on team %s: %v\n", teamID, err)
		return
	}
	if err := billingProvider.UpdateSeats(subscriptionID.String, memberCount); err != nil {
		log.Printf("[BILLING] Failed to sync seat count for team %s subscription %s: %v\n", teamID, subscriptionID.String, err)
		return
	}
	if _, err := db.Exec("UPDATE teams SET subscription_seats = ? WHERE id = ?", memberCount, teamID); err != nil {
		log.Printf("[BILLING] Failed to persist synced seat count for team %s: %v\n", teamID, err)
	}
}
