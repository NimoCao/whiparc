package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const (
	tcTemplate = "tmpl_contrib"
	tcAuthor   = "u_author"
	tcContrib  = "u_contrib"
	tcProject  = "proj_contrib"
)

func setupContributionTest(t *testing.T) func() {
	t.Helper()
	oldDB := db
	testDB := setupAuthTestDB(t)
	testDB.SetMaxOpenConns(1)
	db = testDB

	stmts := []string{
		"INSERT INTO users (id, email, name, email_verified) VALUES ('u_author', 'author@test.com', 'Author', TRUE)",
		"INSERT INTO users (id, email, name, email_verified) VALUES ('u_contrib', 'contrib@test.com', 'Contributor', TRUE)",
		"INSERT INTO users (id, email, name, email_verified) VALUES ('u_other', 'other@test.com', 'Other', TRUE)",
		"INSERT INTO teams (id, name, slug, owner_id) VALUES ('t_c', 'Contrib Co', 'contrib-co', 'u_contrib')",
		"INSERT INTO projects (id, team_id, name, visibility, created_by) VALUES ('proj_contrib', 't_c', 'My copy', 'PRIVATE', 'u_contrib')",
		`INSERT INTO canvas_states (project_id, nodes_json, edges_json, viewport_json, updated_by) VALUES ('proj_contrib', '[{"id":"n1"},{"id":"n2"}]', '[]', '{"x":0,"y":0,"zoom":1}', 'u_contrib')`,
		`INSERT INTO templates (id, author_user_id, title, nodes_json, edges_json, status) VALUES ('tmpl_contrib', 'u_author', 'T', '[{"id":"n1"}]', '[]', 'PUBLISHED')`,
		`INSERT INTO templates (id, author_user_id, title, nodes_json, edges_json, status) VALUES ('tmpl_official', 'whiparc_official', 'Official', '[{"id":"n1"}]', '[]', 'PUBLISHED')`,
	}
	for _, s := range stmts {
		if _, err := testDB.Exec(s); err != nil {
			t.Fatalf("seed %q: %v", s, err)
		}
	}
	return func() {
		testDB.Close()
		db = oldDB
	}
}

func tcCall(h http.HandlerFunc, claims *TokenClaims, method, body string, path map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/x", bytes.NewReader([]byte(body)))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, claims))
	for k, v := range path {
		req.SetPathValue(k, v)
	}
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

func submitContribution(t *testing.T, templateID, note string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"project_id": tcProject, "note": note})
	return tcCall(handleCreateTemplateContribution, &TokenClaims{ID: tcContrib}, http.MethodPost, string(body), map[string]string{"id": templateID})
}

func TestContributionSubmitValidation(t *testing.T) {
	defer setupContributionTest(t)()

	if w := submitContribution(t, tcTemplate, "  "); w.Code != http.StatusBadRequest {
		t.Errorf("empty note must be 400, got %d", w.Code)
	}
	if w := submitContribution(t, "tmpl_missing", "x"); w.Code != http.StatusNotFound {
		t.Errorf("unknown template must be 404, got %d", w.Code)
	}

	// The author cannot contribute to their own template.
	body, _ := json.Marshal(map[string]string{"project_id": tcProject, "note": "x"})
	if w := tcCall(handleCreateTemplateContribution, &TokenClaims{ID: tcAuthor}, http.MethodPost, string(body), map[string]string{"id": tcTemplate}); w.Code != http.StatusBadRequest {
		t.Errorf("author contributing to own template must be 400, got %d", w.Code)
	}

	// Someone without admin access to the project cannot snapshot it.
	if w := tcCall(handleCreateTemplateContribution, &TokenClaims{ID: "u_other"}, http.MethodPost, string(body), map[string]string{"id": tcTemplate}); w.Code != http.StatusForbidden {
		t.Errorf("non-member must be 403, got %d: %s", w.Code, w.Body.String())
	}

	// An unchanged canvas is refused.
	if _, err := db.Exec(`UPDATE canvas_states SET nodes_json = '[{"id":"n1"}]' WHERE project_id = ?`, tcProject); err != nil {
		t.Fatal(err)
	}
	if w := submitContribution(t, tcTemplate, "no change"); w.Code != http.StatusBadRequest {
		t.Errorf("identical canvas must be 400, got %d", w.Code)
	}
}

func TestContributionAcceptAppliesCanvasAndBlocksDuplicates(t *testing.T) {
	defer setupContributionTest(t)()

	w := submitContribution(t, tcTemplate, "added a second node")
	if w.Code != http.StatusCreated {
		t.Fatalf("submit: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &created)

	if w := submitContribution(t, tcTemplate, "again"); w.Code != http.StatusConflict {
		t.Errorf("second pending contribution by the same user must be 409, got %d", w.Code)
	}

	path := map[string]string{"id": tcTemplate, "cid": created.ID}
	// Only the author reviews.
	if w := tcCall(handleAcceptTemplateContribution, &TokenClaims{ID: tcContrib}, http.MethodPost, "", path); w.Code != http.StatusForbidden {
		t.Errorf("contributor must not review their own submission, got %d", w.Code)
	}
	if w := tcCall(handleListTemplateContributions, &TokenClaims{ID: "u_other"}, http.MethodGet, "", map[string]string{"id": tcTemplate}); w.Code != http.StatusForbidden {
		t.Errorf("non-author must not list contributions, got %d", w.Code)
	}

	w = tcCall(handleListTemplateContributions, &TokenClaims{ID: tcAuthor}, http.MethodGet, "", map[string]string{"id": tcTemplate})
	var list struct {
		Contributions []templateContribution `json:"contributions"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if w.Code != http.StatusOK || len(list.Contributions) != 1 || list.Contributions[0].ContributorName != "Contributor" || list.Contributions[0].NodesJSON == "" {
		t.Fatalf("author list wrong: %d %s", w.Code, w.Body.String())
	}

	if w := tcCall(handleAcceptTemplateContribution, &TokenClaims{ID: tcAuthor}, http.MethodPost, "", path); w.Code != http.StatusOK {
		t.Fatalf("accept: %d %s", w.Code, w.Body.String())
	}
	var nodes string
	_ = db.QueryRow("SELECT nodes_json FROM templates WHERE id = ?", tcTemplate).Scan(&nodes)
	if nodes != `[{"id":"n1"},{"id":"n2"}]` {
		t.Errorf("accepted canvas was not applied to the template: %s", nodes)
	}
	if w := tcCall(handleAcceptTemplateContribution, &TokenClaims{ID: tcAuthor}, http.MethodPost, "", path); w.Code != http.StatusNotFound {
		t.Errorf("reviewing twice must 404, got %d", w.Code)
	}
}

func TestContributionRejectLeavesTemplateUntouched(t *testing.T) {
	defer setupContributionTest(t)()
	w := submitContribution(t, tcTemplate, "try this")
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &created)

	path := map[string]string{"id": tcTemplate, "cid": created.ID}
	if w := tcCall(handleRejectTemplateContribution, &TokenClaims{ID: tcAuthor}, http.MethodPost, `{"review_note":"out of scope"}`, path); w.Code != http.StatusOK {
		t.Fatalf("reject: %d %s", w.Code, w.Body.String())
	}
	var nodes string
	_ = db.QueryRow("SELECT nodes_json FROM templates WHERE id = ?", tcTemplate).Scan(&nodes)
	if nodes != `[{"id":"n1"}]` {
		t.Errorf("a rejected contribution must not change the template: %s", nodes)
	}

	w = tcCall(handleListMyContributions, &TokenClaims{ID: tcContrib}, http.MethodGet, "", nil)
	var mine struct {
		Contributions []templateContribution `json:"contributions"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &mine)
	if len(mine.Contributions) != 1 || mine.Contributions[0].Status != "REJECTED" || mine.Contributions[0].ReviewNote != "out of scope" || mine.Contributions[0].NodesJSON != "" {
		t.Errorf("my contributions wrong: %s", w.Body.String())
	}

	// With the first one resolved the contributor may submit again.
	if w := submitContribution(t, tcTemplate, "second attempt"); w.Code != http.StatusCreated {
		t.Errorf("resubmission after a review must work, got %d: %s", w.Code, w.Body.String())
	}
}

func TestOfficialTemplateContributionsNeedACurator(t *testing.T) {
	defer setupContributionTest(t)()
	t.Setenv("TEMPLATE_CURATOR_EMAILS", "")

	if w := submitContribution(t, "tmpl_official", "improve it"); w.Code != http.StatusCreated {
		t.Fatalf("anyone can contribute to an official template: %d %s", w.Code, w.Body.String())
	}
	listPath := map[string]string{"id": "tmpl_official"}
	curator := &TokenClaims{ID: tcAuthor, Email: "author@test.com", EmailVerified: true}
	if w := tcCall(handleListTemplateContributions, curator, http.MethodGet, "", listPath); w.Code != http.StatusForbidden {
		t.Errorf("with no curators configured nobody reviews official templates, got %d", w.Code)
	}
	t.Setenv("TEMPLATE_CURATOR_EMAILS", "x@y.com, Author@Test.com")
	if w := tcCall(handleListTemplateContributions, curator, http.MethodGet, "", listPath); w.Code != http.StatusOK {
		t.Errorf("a listed curator may review, got %d", w.Code)
	}
	unverified := &TokenClaims{ID: tcAuthor, Email: "author@test.com", EmailVerified: false}
	if w := tcCall(handleListTemplateContributions, unverified, http.MethodGet, "", listPath); w.Code != http.StatusForbidden {
		t.Errorf("an unverified email must not count as curator, got %d", w.Code)
	}
}

func TestPendingContributionsInbox(t *testing.T) {
	defer setupContributionTest(t)()
	t.Setenv("TEMPLATE_CURATOR_EMAILS", "")

	if w := submitContribution(t, tcTemplate, "to the author"); w.Code != http.StatusCreated {
		t.Fatalf("submit: %d", w.Code)
	}
	pending := func(c *TokenClaims) int {
		w := tcCall(handleListPendingContributions, c, http.MethodGet, "", nil)
		var out struct {
			Contributions []templateContribution `json:"contributions"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return len(out.Contributions)
	}
	if n := pending(&TokenClaims{ID: tcAuthor}); n != 1 {
		t.Errorf("the template's author should see 1 pending contribution, got %d", n)
	}
	if n := pending(&TokenClaims{ID: tcContrib}); n != 0 {
		t.Errorf("the contributor is not a reviewer, got %d", n)
	}

	// A contribution to an official template reaches only curators.
	if _, err := db.Exec(`INSERT INTO template_contributions (id, template_id, contributor_user_id, note, nodes_json, edges_json) VALUES ('tcon_off', 'tmpl_official', ?, 'x', '[]', '[]')`, tcContrib); err != nil {
		t.Fatal(err)
	}
	curator := &TokenClaims{ID: "u_other", Email: "other@test.com", EmailVerified: true}
	if n := pending(curator); n != 0 {
		t.Errorf("no curators configured, got %d", n)
	}
	t.Setenv("TEMPLATE_CURATOR_EMAILS", "other@test.com")
	if n := pending(curator); n != 1 {
		t.Errorf("a curator should see the official template's contribution, got %d", n)
	}
}
