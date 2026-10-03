package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func withTestDB(t *testing.T) *dbHandle {
	t.Helper()
	oldDB, oldAvatar, oldDel := db, avatarLimiter, deleteAcctLimiter
	testDB := setupAuthTestDB(t)
	db = testDB
	avatarLimiter = NewRateLimiter(100, time.Minute, 100)
	deleteAcctLimiter = NewRateLimiter(100, time.Minute, 100)
	t.Cleanup(func() {
		db, avatarLimiter, deleteAcctLimiter = oldDB, oldAvatar, oldDel
		testDB.Close()
	})
	return testDB
}

func asUser(r *http.Request, id string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), userContextKey, &TokenClaims{ID: id}))
}

func solidImage(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 120, A: 255})
		}
	}
	return img
}

func pngBytes(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func jpegBytes(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func uploadReq(t *testing.T, userID, filename string, data []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("avatar", filename)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data)
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/avatar", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return asUser(req, userID)
}

var (
	testHashOnce sync.Once
	testHash     string
)

func seedUser(t *testing.T, id, email string) {
	t.Helper()
	// Hashing is deliberately expensive; do it once per test binary.
	testHashOnce.Do(func() { testHash, _ = hashPassword("correct-horse") })
	hash := testHash
	if _, err := db.Exec("INSERT INTO users (id, email, password_hash, name, email_verified) VALUES (?, ?, ?, ?, TRUE)", id, email, hash, "User "+id); err != nil {
		t.Fatal(err)
	}
}

func TestAvatarUploadAcceptsJPGAndPNGAndNormalizes(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")

	for name, data := range map[string][]byte{
		"photo.png":  pngBytes(t, solidImage(640, 480)),
		"photo.jpg":  jpegBytes(t, solidImage(300, 900)),
		"tiny.jpeg":  jpegBytes(t, solidImage(64, 64)),
		"exact.png":  pngBytes(t, solidImage(256, 256)),
		"nolook.PNG": pngBytes(t, solidImage(1000, 1000)),
	} {
		w := httptest.NewRecorder()
		handleUploadAvatar(w, uploadReq(t, "u_1", name, data))
		if w.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d: %s", name, w.Code, w.Body.String())
		}
	}

	var resp struct {
		User struct {
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	w := httptest.NewRecorder()
	handleUploadAvatar(w, uploadReq(t, "u_1", "a.png", pngBytes(t, solidImage(500, 300))))
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if !strings.HasPrefix(resp.User.AvatarURL, avatarURLPrefix) {
		t.Fatalf("expected a local avatar path, got %q", resp.User.AvatarURL)
	}

	// Served image is a 256x256 PNG with hardened headers.
	req := httptest.NewRequest(http.MethodGet, resp.User.AvatarURL, nil)
	req.SetPathValue("key", strings.TrimPrefix(resp.User.AvatarURL, avatarURLPrefix))
	sw := httptest.NewRecorder()
	handleGetAvatar(sw, req)
	if sw.Code != http.StatusOK {
		t.Fatalf("serve: %d", sw.Code)
	}
	if ct := sw.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content-type %q", ct)
	}
	if sw.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(sw.Header().Get("Content-Security-Policy"), "default-src 'none'") {
		t.Fatalf("missing hardening headers: %v", sw.Header())
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(sw.Body.Bytes()))
	if err != nil || format != "png" || cfg.Width != avatarSize || cfg.Height != avatarSize {
		t.Fatalf("expected %dx%d png, got %v %dx%d (%v)", avatarSize, avatarSize, format, cfg.Width, cfg.Height, err)
	}

	var rows int
	_ = db.QueryRow("SELECT COUNT(*) FROM user_avatars WHERE user_id = 'u_1'").Scan(&rows)
	if rows != 1 {
		t.Fatalf("expected exactly one stored avatar after repeated uploads, got %d", rows)
	}
}

func TestAvatarUploadRejectsEverythingElse(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")

	var gifBuf bytes.Buffer
	_ = gif.Encode(&gifBuf, solidImage(100, 100), nil)

	cases := map[string][]byte{
		"avatar.gif":                  gifBuf.Bytes(),
		"avatar.svg":                  []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`),
		"script.png":                  []byte("<script>alert(1)</script>"),
		"html.jpg":                    []byte("<html><body>hi</body></html>"),
		"empty.png":                   {},
		"truncated.png":               pngBytes(t, solidImage(200, 200))[:60],
		"toosmall.png":                pngBytes(t, solidImage(8, 8)),
		"toobig.png":                  pngBytes(t, image.NewGray(image.Rect(0, 0, avatarMaxSourceDim+1, 64))),
		"webp-lookalike.jpg":          []byte("RIFF\x00\x00\x00\x00WEBPVP8 "),
		"exe-renamed.png":             []byte("MZ\x90\x00\x03\x00\x00\x00"),
		"png-ext-but-jpeg-and-junk.x": append(jpegBytes(t, solidImage(10, 10))[:20], []byte("garbage")...),
	}
	for name, data := range cases {
		w := httptest.NewRecorder()
		handleUploadAvatar(w, uploadReq(t, "u_1", name, data))
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d: %s", name, w.Code, w.Body.String())
		}
	}
	var rows int
	_ = db.QueryRow("SELECT COUNT(*) FROM user_avatars").Scan(&rows)
	if rows != 0 {
		t.Fatalf("rejected uploads must not be stored, found %d", rows)
	}
}

func TestAvatarUploadStripsAppendedPayload(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")

	secret := []byte("<script>alert('polyglot')</script>")
	polyglot := append(pngBytes(t, solidImage(200, 200)), secret...)
	w := httptest.NewRecorder()
	handleUploadAvatar(w, uploadReq(t, "u_1", "p.png", polyglot))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var data []byte
	_ = db.QueryRow("SELECT data FROM user_avatars WHERE user_id = 'u_1'").Scan(&data)
	if bytes.Contains(data, secret) {
		t.Fatal("appended payload survived re-encoding")
	}
}

func TestAvatarUploadTooLarge(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")
	big := append(pngBytes(t, solidImage(100, 100)), make([]byte, avatarMaxUploadBytes+10)...)
	w := httptest.NewRecorder()
	handleUploadAvatar(w, uploadReq(t, "u_1", "big.png", big))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetAvatarRejectsBadKeys(t *testing.T) {
	withTestDB(t)
	for _, key := range []string{"", "abc", "../../etc/passwd", strings.Repeat("g", 32), strings.Repeat("a", 32)} {
		req := httptest.NewRequest(http.MethodGet, "/api/avatars/x", nil)
		req.SetPathValue("key", key)
		w := httptest.NewRecorder()
		handleGetAvatar(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("key %q: expected 404, got %d", key, w.Code)
		}
	}
}

func TestMigrationClearsLegacyExternalAvatarURLs(t *testing.T) {
	// A fresh DB runs every migration up front, so simulate the pre-13 state
	// by re-running the migration body against a user that still has one.
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")
	if _, err := db.Exec("UPDATE users SET avatar_url = 'https://tracker.example/pixel.png' WHERE id = 'u_1'"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("DROP TABLE user_avatars"); err != nil {
		t.Fatal(err)
	}
	for _, m := range migrations {
		if m.version == 13 {
			tx, _ := db.Begin()
			if err := m.up(tx); err != nil {
				t.Fatal(err)
			}
			_ = tx.Commit()
		}
	}
	var url *string
	_ = db.QueryRow("SELECT avatar_url FROM users WHERE id = 'u_1'").Scan(&url)
	if url != nil {
		t.Fatalf("legacy external avatar should be cleared, got %q", *url)
	}
}

// --- account deletion ---

func deleteReq(userID, password, confirmEmail string) *http.Request {
	body, _ := json.Marshal(map[string]string{"password": password, "confirm_email": confirmEmail})
	return asUser(httptest.NewRequest(http.MethodDelete, "/api/auth/account", bytes.NewReader(body)), userID)
}

func count(t *testing.T, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDeleteAccountRequiresReauth(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")
	if _, err := db.Exec("INSERT INTO users (id, email, name, email_verified) VALUES ('u_oauth', 'o@test.com', 'O', TRUE)"); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name     string
		req      *http.Request
		wantCode int
	}{
		{"wrong password", deleteReq("u_1", "nope", "a@test.com"), http.StatusUnauthorized},
		{"empty password", deleteReq("u_1", "", "a@test.com"), http.StatusUnauthorized},
		{"wrong email confirmation", deleteReq("u_1", "correct-horse", "other@test.com"), http.StatusBadRequest},
		{"missing email confirmation", deleteReq("u_1", "correct-horse", ""), http.StatusBadRequest},
		{"oauth-only account has no password", deleteReq("u_oauth", "anything", "o@test.com"), http.StatusBadRequest},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		handleDeleteAccount(w, tc.req)
		if w.Code != tc.wantCode {
			t.Errorf("%s: expected %d, got %d: %s", tc.name, tc.wantCode, w.Code, w.Body.String())
		}
	}
	if count(t, "SELECT COUNT(*) FROM users") != 2 {
		t.Fatal("no user may be deleted by a failed re-auth")
	}
}

func TestDeleteAccountRateLimited(t *testing.T) {
	withTestDB(t)
	deleteAcctLimiter = NewRateLimiter(1, time.Hour, 2)
	seedUser(t, "u_1", "a@test.com")
	var last int
	for i := 0; i < 4; i++ {
		w := httptest.NewRecorder()
		handleDeleteAccount(w, deleteReq("u_1", "bad", "a@test.com"))
		last = w.Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after repeated attempts, got %d", last)
	}
}

func seedTeamWithProject(t *testing.T, teamID, ownerID, projectID, creatorID string) {
	t.Helper()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)", []any{teamID, teamID, teamID, ownerID}},
		{"INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, 'OWNER')", []any{"tm_" + teamID + ownerID, teamID, ownerID}},
		{"INSERT INTO projects (id, team_id, name, created_by) VALUES (?, ?, 'P', ?)", []any{projectID, teamID, creatorID}},
		{"INSERT INTO canvas_states (project_id, nodes_json, edges_json, viewport_json, updated_by) VALUES (?, '[]', '[]', '{}', ?)", []any{projectID, creatorID}},
		{"INSERT INTO canvas_snapshots (id, project_id, version, nodes_json, edges_json, created_by) VALUES (?, ?, 1, '[]', '[]', ?)", []any{"snap_" + projectID, projectID, creatorID}},
		{"INSERT INTO cloud_credentials (id, project_id, provider, name, encrypted_data, nonce, auth_tag, key_fingerprint, created_by) VALUES (?, ?, 'AWS', 'c', x'01', x'02', x'03', 'fp', ?)", []any{"cred_" + projectID, projectID, creatorID}},
	} {
		if _, err := db.Exec(q.sql, q.args...); err != nil {
			t.Fatalf("seed %q: %v", q.sql, err)
		}
	}
}

func TestDeleteAccountRemovesSoloTeamsAndReassignsSharedWork(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_del", "del@test.com")
	seedUser(t, "u_other", "other@test.com")

	// u_del's own solo team + project (with a credential) — must vanish entirely.
	seedTeamWithProject(t, "team_mine", "u_del", "proj_mine", "u_del")
	// Another user's team; u_del is a plain member who created a project there.
	seedTeamWithProject(t, "team_theirs", "u_other", "proj_theirs", "u_del")
	if _, err := db.Exec("INSERT INTO team_members (id, team_id, user_id, role) VALUES ('tm_x', 'team_theirs', 'u_del', 'MEMBER')"); err != nil {
		t.Fatal(err)
	}
	db.Exec("INSERT INTO project_members (id, project_id, user_id, role, added_by) VALUES ('pm1', 'proj_theirs', 'u_del', 'EDITOR', 'u_other')")
	db.Exec("INSERT INTO templates (id, author_user_id, title, nodes_json, edges_json) VALUES ('tpl1', 'u_del', 'T', '[]', '[]')")
	db.Exec("INSERT INTO oauth_identities (id, user_id, provider, provider_user_id) VALUES ('oi1', 'u_del', 'github', 'gh1')")
	db.Exec("INSERT INTO user_avatars (user_id, key, mime, data) VALUES ('u_del', 'k', 'image/png', x'00')")
	db.Exec("INSERT INTO activity_events (id, project_id, actor_id, kind) VALUES ('ev1', 'proj_theirs', 'u_del', 'x')")

	w := httptest.NewRecorder()
	handleDeleteAccount(w, deleteReq("u_del", "correct-horse", "DEL@test.com"))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	for table, q := range map[string]string{
		"user":              "SELECT COUNT(*) FROM users WHERE id = 'u_del'",
		"solo team":         "SELECT COUNT(*) FROM teams WHERE id = 'team_mine'",
		"solo project":      "SELECT COUNT(*) FROM projects WHERE id = 'proj_mine'",
		"solo canvas":       "SELECT COUNT(*) FROM canvas_states WHERE project_id = 'proj_mine'",
		"solo credential":   "SELECT COUNT(*) FROM cloud_credentials WHERE project_id = 'proj_mine'",
		"solo snapshots":    "SELECT COUNT(*) FROM canvas_snapshots WHERE project_id = 'proj_mine'",
		"memberships":       "SELECT COUNT(*) FROM team_members WHERE user_id = 'u_del'",
		"project member":    "SELECT COUNT(*) FROM project_members WHERE user_id = 'u_del'",
		"template":          "SELECT COUNT(*) FROM templates WHERE author_user_id = 'u_del'",
		"oauth identity":    "SELECT COUNT(*) FROM oauth_identities WHERE user_id = 'u_del'",
		"avatar":            "SELECT COUNT(*) FROM user_avatars WHERE user_id = 'u_del'",
		"actor in activity": "SELECT COUNT(*) FROM activity_events WHERE actor_id = 'u_del'",
	} {
		if n := count(t, q); n != 0 {
			t.Errorf("%s: expected 0 rows left, found %d", table, n)
		}
	}

	// Teammate's data survives and is reassigned to the team owner.
	if count(t, "SELECT COUNT(*) FROM projects WHERE id = 'proj_theirs' AND created_by = 'u_other'") != 1 {
		t.Error("shared project should be reassigned to the team owner")
	}
	if count(t, "SELECT COUNT(*) FROM canvas_states WHERE project_id = 'proj_theirs' AND updated_by = 'u_other'") != 1 {
		t.Error("canvas updated_by should be reassigned")
	}
	if count(t, "SELECT COUNT(*) FROM cloud_credentials WHERE project_id = 'proj_theirs' AND created_by = 'u_other'") != 1 {
		t.Error("credential created_by should be reassigned")
	}
	if count(t, "SELECT COUNT(*) FROM activity_events WHERE id = 'ev1'") != 1 {
		t.Error("audit event row must be kept")
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE id = 'u_other'") != 1 {
		t.Error("other users must be untouched")
	}
}

func TestDeleteAccountBlockedByTeamWithMembersOrSubscription(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_owner", "owner@test.com")
	seedUser(t, "u_mem", "mem@test.com")
	seedTeamWithProject(t, "team_a", "u_owner", "proj_a", "u_owner")
	db.Exec("INSERT INTO team_members (id, team_id, user_id, role) VALUES ('tm_m', 'team_a', 'u_mem', 'MEMBER')")

	w := httptest.NewRecorder()
	handleDeleteAccount(w, deleteReq("u_owner", "correct-horse", "owner@test.com"))
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for team with members, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Blockers []accountDeleteBlocker `json:"blockers"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Blockers) != 1 || resp.Blockers[0].TeamID != "team_a" {
		t.Fatalf("unexpected blockers: %+v", resp.Blockers)
	}

	// Remove the member; now a live subscription blocks instead.
	db.Exec("DELETE FROM team_members WHERE id = 'tm_m'")
	db.Exec("UPDATE teams SET billing_subscription_id = 'sub_1', subscription_status = 'active', plan = 'PRO' WHERE id = 'team_a'")
	w = httptest.NewRecorder()
	handleDeleteAccount(w, deleteReq("u_owner", "correct-horse", "owner@test.com"))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "subscription") {
		t.Fatalf("expected 409 for live subscription, got %d: %s", w.Code, w.Body.String())
	}

	// A canceled subscription no longer blocks.
	db.Exec("UPDATE teams SET subscription_status = 'canceled' WHERE id = 'team_a'")
	w = httptest.NewRecorder()
	handleDeleteAccount(w, deleteReq("u_owner", "correct-horse", "owner@test.com"))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 once subscription is canceled, got %d: %s", w.Code, w.Body.String())
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE id = 'u_owner'") != 0 {
		t.Fatal("owner should be deleted")
	}
}

func TestAuthMiddlewareRejectsTokenOfDeletedAccount(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_1", "a@test.com")
	token, _ := GenerateToken("u_1", "a@test.com", "A", true)

	h := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}
	if c := call(); c != http.StatusOK {
		t.Fatalf("live account: expected 200, got %d", c)
	}
	db.Exec("DELETE FROM users WHERE id = 'u_1'")
	if c := call(); c != http.StatusUnauthorized {
		t.Fatalf("deleted account: expected 401, got %d", c)
	}
}

// --- live presence ---

func TestWorkspaceSyncRejectsUsersWithoutProjectAccess(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_owner", "owner@test.com")
	seedUser(t, "u_outsider", "outsider@test.com")
	seedTeamWithProject(t, "team_x", "u_owner", "proj_x", "u_owner")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/workspace/{projectId}/sync", handleWorkspaceWebSocketSync)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	tok, _ := GenerateToken("u_outsider", "outsider@test.com", "Outsider", true)
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/workspace/proj_x/sync?token=" + tok
	_, resp, err := websocket.DefaultDialer.Dial(u, http.Header{"Origin": {allowedOrigin()}})
	if err == nil {
		t.Fatal("expected the handshake to be rejected for a user with no access to the project")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		code := 0
		if resp != nil {
			code = resp.StatusCode
		}
		t.Fatalf("expected 403, got %d (%v)", code, err)
	}

	// A real project member still connects fine.
	memberTok, _ := GenerateToken("u_owner", "owner@test.com", "Owner", true)
	u2 := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/workspace/proj_x/sync?token=" + memberTok
	conn, _, err := websocket.DefaultDialer.Dial(u2, http.Header{"Origin": {allowedOrigin()}})
	if err != nil {
		t.Fatalf("expected the project owner to connect, got %v", err)
	}
	conn.Close()
}

func TestProfileChangeIsPushedToCollaboratorsInWorkspace(t *testing.T) {
	withTestDB(t)
	seedUser(t, "u_a", "a@test.com")
	seedUser(t, "u_b", "b@test.com")
	seedTeamWithProject(t, "team_p1", "u_a", "p1", "u_a")
	if _, err := db.Exec("INSERT INTO project_members (id, project_id, user_id, role, added_by) VALUES ('pm_b', 'p1', 'u_b', 'EDITOR', 'u_a')"); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/workspace/{projectId}/sync", handleWorkspaceWebSocketSync)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	dial := func(userID string) *websocket.Conn {
		tok, _ := GenerateToken(userID, userID+"@test.com", "stale-jwt-name", true)
		u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/workspace/p1/sync?token=" + tok
		c, _, err := websocket.DefaultDialer.Dial(u, http.Header{"Origin": {allowedOrigin()}})
		if err != nil {
			t.Fatalf("dial %s: %v", userID, err)
		}
		return c
	}
	read := func(c *websocket.Conn, want string) SyncMessage {
		t.Helper()
		_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			var m SyncMessage
			if err := c.ReadJSON(&m); err != nil {
				t.Fatalf("waiting for %q: %v", want, err)
			}
			if m.Type == want {
				return m
			}
		}
	}

	a := dial("u_a")
	defer a.Close()
	read(a, "init")
	b := dial("u_b")
	defer b.Close()
	initB := read(b, "init")

	// Presence advertises the DB name (not the stale JWT name) and avatar_url.
	var members []map[string]string
	_ = json.Unmarshal(initB.Payload, &members)
	for _, m := range members {
		if m["name"] != "User "+m["id"] {
			t.Fatalf("presence should use the live DB name, got %+v", m)
		}
		if _, ok := m["avatar_url"]; !ok {
			t.Fatalf("presence entries must carry avatar_url: %+v", m)
		}
	}
	read(a, "join")

	// u_a uploads an avatar while both are in the room.
	w := httptest.NewRecorder()
	handleUploadAvatar(w, uploadReq(t, "u_a", "a.png", pngBytes(t, solidImage(120, 120))))
	if w.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}

	msg := read(b, "profile")
	var p map[string]string
	_ = json.Unmarshal(msg.Payload, &p)
	if p["id"] != "u_a" || !strings.HasPrefix(p["avatar_url"], avatarURLPrefix) {
		t.Fatalf("collaborator should be told about the new avatar, got %+v", p)
	}

	// A fresh joiner sees the updated avatar in the initial roster, too.
	c := dial("u_b")
	defer c.Close()
	var roster []map[string]string
	_ = json.Unmarshal(read(c, "init").Payload, &roster)
	found := false
	for _, m := range roster {
		if m["id"] == "u_a" && strings.HasPrefix(m["avatar_url"], avatarURLPrefix) {
			found = true
		}
	}
	if !found {
		t.Fatalf("roster for a late joiner is missing u_a's avatar: %+v", roster)
	}
}
