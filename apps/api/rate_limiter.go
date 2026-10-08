package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type rateBucket struct {
	tokens     int
	lastRefill time.Time
}

// RateLimiter implements an in-memory token bucket rate limiter.
type RateLimiter struct {
	mu          sync.Mutex
	buckets     map[string]*rateBucket
	rate        int           // tokens added per window
	window      time.Duration // window duration
	capacity    int           // max token capacity
	stopJanitor chan struct{}
}

// NewRateLimiter creates a RateLimiter that allows `capacity` requests, refilling `rate` tokens every `window`.
func NewRateLimiter(rate int, window time.Duration, capacity int) *RateLimiter {
	rl := &RateLimiter{
		buckets:     make(map[string]*rateBucket),
		rate:        rate,
		window:      window,
		capacity:    capacity,
		stopJanitor: make(chan struct{}),
	}

	// Background cleanup of idle keys
	go rl.janitor(10 * time.Minute)
	return rl
}

func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, exists := rl.buckets[key]
	if !exists {
		rl.buckets[key] = &rateBucket{
			tokens:     rl.capacity - 1,
			lastRefill: now,
		}
		return true
	}

	// Refill tokens proportional to elapsed time
	elapsed := now.Sub(b.lastRefill)
	if elapsed >= rl.window {
		periods := int(elapsed / rl.window)
		b.tokens += periods * rl.rate
		if b.tokens > rl.capacity {
			b.tokens = rl.capacity
		}
		b.lastRefill = b.lastRefill.Add(time.Duration(periods) * rl.window)
	}

	if b.tokens > 0 {
		b.tokens--
		return true
	}

	return false
}

func (rl *RateLimiter) janitor(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rl.mu.Lock()
			now := time.Now()
			for k, b := range rl.buckets {
				if now.Sub(b.lastRefill) > 2*rl.window && b.tokens >= rl.capacity {
					delete(rl.buckets, k)
				}
			}
			rl.mu.Unlock()
		case <-rl.stopJanitor:
			return
		}
	}
}

// defaultTrustedProxyCIDRs is what ClientIP trusts to set forwarding headers
// when TRUSTED_PROXY_CIDRS is unset: loopback and private ranges. That covers
// the documented production shape (deploy/Caddyfile on the same host, reaching
// the container via localhost:8080, which the container sees as its Docker
// bridge gateway) and a typical private load balancer, while a request that
// arrives straight from the public internet has a public peer address and so
// never has its forwarding headers believed.
const defaultTrustedProxyCIDRs = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"

// trustedProxies is the set of peers allowed to supply X-Forwarded-For /
// X-Real-IP. Set once at startup from TRUSTED_PROXY_CIDRS.
var trustedProxies = mustParseTrustedProxies(os.Getenv("TRUSTED_PROXY_CIDRS"))

func mustParseTrustedProxies(spec string) []*net.IPNet {
	nets, err := parseTrustedProxies(spec)
	if err != nil {
		log.Fatalf("[CONFIG] Invalid TRUSTED_PROXY_CIDRS: %v\n", err)
	}
	return nets
}

// parseTrustedProxies parses a comma-separated CIDR list (bare IPs are
// accepted as single-host ranges). An empty spec selects
// defaultTrustedProxyCIDRs; "none" trusts no proxy at all, so every request is
// attributed to its direct peer.
func parseTrustedProxies(spec string) ([]*net.IPNet, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		spec = defaultTrustedProxyCIDRs
	}
	if strings.EqualFold(spec, "none") {
		return nil, nil
	}

	var nets []*net.IPNet
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !strings.Contains(part, "/") {
			ip := net.ParseIP(part)
			if ip == nil {
				return nil, fmt.Errorf("%q is not a CIDR or IP address", part)
			}
			bits := 128
			if ip.To4() != nil {
				bits = 32
			}
			part = fmt.Sprintf("%s/%d", ip, bits)
		}
		_, n, err := net.ParseCIDR(part)
		if err != nil {
			return nil, fmt.Errorf("%q: %w", part, err)
		}
		nets = append(nets, n)
	}
	return nets, nil
}

func isTrustedProxy(ip net.IP) bool {
	for _, n := range trustedProxies {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// ClientIP returns the address rate limiters (and anything else per-client)
// should key on.
//
// The direct peer (r.RemoteAddr) is the only value a client cannot choose, so
// it is the default. X-Forwarded-For / X-Real-IP are honoured only when that
// peer is a trusted proxy (see trustedProxies); otherwise they are attacker
// controlled and ignored — believing them unconditionally let a caller defeat
// every per-IP limiter by sending a fresh random header value per request.
//
// When the peer is a trusted proxy, X-Forwarded-For is walked from the right,
// skipping further trusted hops, and the first address that is not a trusted
// proxy is the client. Everything to the left of that point was supplied by
// the client or an untrusted hop and is never consulted.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer := net.ParseIP(host)
	if peer == nil {
		return host
	}
	if !isTrustedProxy(peer) {
		return peer.String()
	}

	client := peer
	if values := r.Header.Values("X-Forwarded-For"); len(values) > 0 {
		hops := strings.Split(strings.Join(values, ","), ",")
		for i := len(hops) - 1; i >= 0; i-- {
			ip := net.ParseIP(strings.TrimSpace(hops[i]))
			if ip == nil {
				break
			}
			client = ip
			if !isTrustedProxy(ip) {
				break
			}
		}
		return client.String()
	}

	if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); ip != nil {
		return ip.String()
	}
	return client.String()
}
