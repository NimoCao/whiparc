package main

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- #116: ClientIP must not believe spoofed forwarding headers ---

func withTrustedProxies(t *testing.T, spec string) {
	t.Helper()
	nets, err := parseTrustedProxies(spec)
	if err != nil {
		t.Fatalf("parseTrustedProxies(%q): %v", spec, err)
	}
	old := trustedProxies
	trustedProxies = nets
	t.Cleanup(func() { trustedProxies = old })
}

func reqFrom(remote string, headers map[string]string) *http.Request {
	r := httptest.NewRequest("POST", "/api/auth/login", nil)
	r.RemoteAddr = remote
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

func TestClientIP(t *testing.T) {
	withTrustedProxies(t, "") // defaults: loopback + private ranges

	cases := []struct {
		name    string
		remote  string
		headers map[string]string
		want    string
	}{
		{"direct public peer ignores spoofed XFF", "203.0.113.7:51000", map[string]string{"X-Forwarded-For": "198.51.100.1"}, "203.0.113.7"},
		{"direct public peer ignores spoofed X-Real-IP", "203.0.113.7:51000", map[string]string{"X-Real-IP": "198.51.100.1"}, "203.0.113.7"},
		{"trusted proxy: single XFF value", "172.18.0.1:40000", map[string]string{"X-Forwarded-For": "198.51.100.1"}, "198.51.100.1"},
		{"trusted proxy: client-prepended spoof is ignored", "172.18.0.1:40000", map[string]string{"X-Forwarded-For": "1.2.3.4, 198.51.100.1"}, "198.51.100.1"},
		{"trusted proxy: skips further trusted hops", "10.0.0.5:40000", map[string]string{"X-Forwarded-For": "198.51.100.1, 10.0.0.9, 172.16.3.3"}, "198.51.100.1"},
		{"trusted proxy: garbage entry stops the walk", "127.0.0.1:40000", map[string]string{"X-Forwarded-For": "not-an-ip, 198.51.100.1, 10.0.0.9"}, "198.51.100.1"},
		{"trusted proxy: X-Real-IP used when no XFF", "127.0.0.1:40000", map[string]string{"X-Real-IP": "198.51.100.2"}, "198.51.100.2"},
		{"trusted proxy: no headers falls back to peer", "127.0.0.1:40000", nil, "127.0.0.1"},
		{"trusted proxy: invalid X-Real-IP falls back to peer", "127.0.0.1:40000", map[string]string{"X-Real-IP": "nope"}, "127.0.0.1"},
		{"ipv6 direct peer is parsed correctly", "[2001:db8::1]:51000", map[string]string{"X-Forwarded-For": "198.51.100.1"}, "2001:db8::1"},
		{"ipv6 loopback proxy is trusted", "[::1]:51000", map[string]string{"X-Forwarded-For": "2001:db8::9"}, "2001:db8::9"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClientIP(reqFrom(tc.remote, tc.headers)); got != tc.want {
				t.Fatalf("ClientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestClientIPTrustedProxyConfig(t *testing.T) {
	t.Run("none trusts no proxy", func(t *testing.T) {
		withTrustedProxies(t, "none")
		got := ClientIP(reqFrom("127.0.0.1:1", map[string]string{"X-Forwarded-For": "198.51.100.1"}))
		if got != "127.0.0.1" {
			t.Fatalf("ClientIP = %q, want the direct peer 127.0.0.1", got)
		}
	})
	t.Run("explicit CIDR list replaces the defaults", func(t *testing.T) {
		withTrustedProxies(t, "203.0.113.0/24, 192.0.2.10")
		if got := ClientIP(reqFrom("203.0.113.9:1", map[string]string{"X-Forwarded-For": "198.51.100.1"})); got != "198.51.100.1" {
			t.Fatalf("listed proxy not trusted: got %q", got)
		}
		if got := ClientIP(reqFrom("192.0.2.10:1", map[string]string{"X-Forwarded-For": "198.51.100.1"})); got != "198.51.100.1" {
			t.Fatalf("bare-IP proxy not trusted: got %q", got)
		}
		if got := ClientIP(reqFrom("10.0.0.5:1", map[string]string{"X-Forwarded-For": "198.51.100.1"})); got != "10.0.0.5" {
			t.Fatalf("a private peer outside the explicit list must not be trusted: got %q", got)
		}
	})
	t.Run("invalid entries are rejected", func(t *testing.T) {
		for _, bad := range []string{"not-a-cidr", "10.0.0.0/99", "10.0.0.0/8,garbage"} {
			if _, err := parseTrustedProxies(bad); err == nil {
				t.Errorf("parseTrustedProxies(%q) = nil error, want an error", bad)
			}
		}
	})
}

// TestRateLimitNotBypassedBySpoofedXFF is the issue #116 reproduction: a fresh
// random X-Forwarded-For per request must not buy a fresh rate-limit bucket.
func TestRateLimitNotBypassedBySpoofedXFF(t *testing.T) {
	withTrustedProxies(t, "")
	rl := NewRateLimiter(1, time.Hour, 3)
	defer close(rl.stopJanitor)

	allowed := 0
	for i := 0; i < 20; i++ {
		ip := net.IPv4(10+byte(i), 1, 2, 3).String()
		if rl.Allow(ClientIP(reqFrom("203.0.113.7:4444", map[string]string{"X-Forwarded-For": ip}))) {
			allowed++
		}
	}
	if allowed != 3 {
		t.Fatalf("allowed %d requests from one real peer with rotating XFF values, want exactly the bucket capacity (3)", allowed)
	}
}

// --- #115: password policy ---

func TestValidatePassword(t *testing.T) {
	tooLong := strings.Repeat("a1", 37) // 74 bytes
	cases := []struct {
		name     string
		password string
		email    string
		name_    string
		wantErr  string // substring; "" means must be accepted
	}{
		{"single character (the #115 PoC)", "a", "", "", "at least 8"},
		{"seven characters", "abcdef9", "", "", "at least 8"},
		{"empty", "", "", "", "at least 8"},
		{"exactly eight", "tr0ub4d&", "", "", ""},
		{"passphrase", "correct horse battery staple", "", "", ""},
		{"multibyte counted in characters", "пароль-пароль", "", "", ""},
		{"too many bytes for bcrypt", tooLong, "", "", "at most 72"},
		{"exactly 72 bytes", strings.Repeat("a1", 36), "", "", ""},
		{"common password", "password123", "", "", "too common"},
		{"common password, mixed case", "PassWord123", "", "", "too common"},
		{"digit run", "1234567890", "", "", "too common"},
		{"repeated character", "zzzzzzzzzzzz", "", "", "single repeated"},
		{"equals email", "alice@genuinecorp.com", "alice@genuinecorp.com", "", "same as your email"},
		{"equals email local part", "alice-genuine", "alice-genuine@genuinecorp.com", "", "same as your email"},
		{"equals name", "Alice Genuine", "alice@genuinecorp.com", "alice genuine", "same as your name"},
		{"contains but is not email", "alice-is-here-42", "alice@genuinecorp.com", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validatePassword(tc.password, tc.email, tc.name_)
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("expected the password to be accepted, got: %v", err)
			case tc.wantErr != "" && err == nil:
				t.Fatalf("expected rejection containing %q, got nil", tc.wantErr)
			case tc.wantErr != "" && !strings.Contains(err.Error(), tc.wantErr):
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestCommonPasswordListMeetsMinimumLength(t *testing.T) {
	// An entry shorter than the length floor can never be reached (the length
	// rule fires first), so it's dead weight and usually a typo.
	for p := range commonPasswords {
		if len(p) < minPasswordLength {
			t.Errorf("commonPasswords entry %q is shorter than minPasswordLength", p)
		}
		if p != strings.ToLower(p) {
			t.Errorf("commonPasswords entry %q must be lower-case (lookups lower-case the input)", p)
		}
	}
}

func TestSignupEnforcesPasswordPolicy(t *testing.T) {
	oldDB, oldLimiter, oldSender := db, signupLimiter, emailSender
	testDB := setupAuthTestDB(t)
	defer testDB.Close()
	db = testDB
	signupLimiter = NewRateLimiter(100, time.Minute, 100)
	emailSender = &ConsoleMailer{}
	defer func() { db, signupLimiter, emailSender = oldDB, oldLimiter, oldSender }()

	signup := func(email, password string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"email": email, "password": password, "name": "Pat Tester"})
		w := httptest.NewRecorder()
		handleSignup(w, httptest.NewRequest("POST", "/api/auth/signup", bytes.NewReader(body)))
		return w
	}

	for _, weak := range []string{"a", "short", "password123", "1234567890"} {
		if w := signup("weak@genuinecorp.com", weak); w.Code != http.StatusBadRequest {
			t.Errorf("signup with password %q: status %d, want 400. Body: %s", weak, w.Code, w.Body.String())
		}
	}

	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", "weak@genuinecorp.com").Scan(&n); err != nil || n != 0 {
		t.Fatalf("rejected signups must not create a user (count=%d, err=%v)", n, err)
	}

	if w := signup("strong@genuinecorp.com", "correct horse battery staple"); w.Code != http.StatusOK {
		t.Fatalf("strong password signup: status %d, want 200. Body: %s", w.Code, w.Body.String())
	}
}

func TestResetPasswordEnforcesPasswordPolicy(t *testing.T) {
	for _, weak := range []string{"short", "password123", "1234567890"} {
		body, _ := json.Marshal(map[string]string{"token": "irrelevant", "password": weak})
		w := httptest.NewRecorder()
		handleResetPassword(w, httptest.NewRequest("POST", "/api/auth/reset", bytes.NewReader(body)))
		if w.Code != http.StatusBadRequest {
			t.Errorf("reset with password %q: status %d, want 400. Body: %s", weak, w.Code, w.Body.String())
		}
	}
}

// --- #117: refuse to boot insecurely against Postgres ---

func TestValidateProductionConfig(t *testing.T) {
	env := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}
	good := map[string]string{"JWT_SECRET": "a-long-random-secret-from-openssl", "FRONTEND_URL": "https://whiparc.com"}

	cases := []struct {
		name    string
		backend string
		env     map[string]string
		wantErr []string // substrings that must all appear; nil means accepted
	}{
		{"sqlite dev with nothing set", "sqlite", map[string]string{}, nil},
		{"postgres fully configured", "postgres", good, nil},
		{"postgres without JWT_SECRET", "postgres", map[string]string{"FRONTEND_URL": "https://whiparc.com"}, []string{"JWT_SECRET is not set"}},
		{"postgres with the public dev secret", "postgres", map[string]string{"JWT_SECRET": devJWTSecret, "FRONTEND_URL": "https://whiparc.com"}, []string{"public development key"}},
		{"postgres without FRONTEND_URL", "postgres", map[string]string{"JWT_SECRET": good["JWT_SECRET"]}, []string{"FRONTEND_URL is not set"}},
		{"postgres with wildcard FRONTEND_URL", "postgres", map[string]string{"JWT_SECRET": good["JWT_SECRET"], "FRONTEND_URL": "*"}, []string{`FRONTEND_URL is "*"`}},
		{"postgres with neither reports both", "postgres", map[string]string{}, []string{"JWT_SECRET is not set", "FRONTEND_URL is not set"}},
		{"explicit local override", "postgres", map[string]string{insecureDevOverrideEnv: "true"}, nil},
		{"override must be exactly true", "postgres", map[string]string{insecureDevOverrideEnv: "1"}, []string{"JWT_SECRET is not set"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateProductionConfig(tc.backend, env(tc.env))
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("expected config to be accepted, got: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected an error containing %v, got nil", tc.wantErr)
			}
			for _, want := range tc.wantErr {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q does not contain %q", err.Error(), want)
				}
			}
		})
	}
}
