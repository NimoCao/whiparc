package main

// Tests for `whiparc projects list`, in particular its --json mode: stdout
// must carry only the JSON array so scripts can pipe it straight into jq.

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
)

// captureStdio runs fn with os.Stdout and os.Stderr redirected to pipes and
// returns what was written to each. It captures the real file descriptors
// rather than a cobra SetOut buffer, so output written with fmt.Println by
// helpers like printInfo or printTable is caught too.
func captureStdio(t *testing.T, fn func()) (stdout, stderr string) {
	t.Helper()

	outR, outW, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe stdout: %v", err)
	}
	errR, errW, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe stderr: %v", err)
	}

	origOut, origErr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = outW, errW
	defer func() { os.Stdout, os.Stderr = origOut, origErr }()

	outDone, errDone := make(chan string), make(chan string)
	read := func(r *os.File, done chan<- string) {
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, r)
		done <- buf.String()
	}
	go read(outR, outDone)
	go read(errR, errDone)

	fn()

	_ = outW.Close()
	_ = errW.Close()
	return <-outDone, <-errDone
}

// runProjectsListCmd points the CLI at a fake API that answers GET
// /api/projects with the given status and body, runs `projects list <args>`,
// and returns the captured stdout and stderr.
func runProjectsListCmd(t *testing.T, status int, body string, args ...string) (stdout, stderr string) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/projects" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)

	home := setSandboxTestHome(t)
	writeTestClientConfig(t, home, srv.URL)

	cmd := projectsListCmd()
	cmd.SetArgs(args)
	return captureStdio(t, func() {
		if err := cmd.Execute(); err != nil {
			t.Errorf("Execute: %v", err)
		}
	})
}

const twoProjectsBody = `[
  {"id":"p1","team_id":"t1","name":"Web & API <prod>","description":"d1","visibility":"PRIVATE","created_by":"u1"},
  {"id":"p2","team_id":"t2","name":"Staging","description":"d2","visibility":"TEAM","created_by":"u2"}
]`

func TestProjectsListJSONPrintsOnlyTheArray(t *testing.T) {
	stdout, stderr := runProjectsListCmd(t, http.StatusOK, twoProjectsBody, "--json")

	if stderr != "" {
		t.Errorf("stderr = %q, want empty for a non-empty list", stderr)
	}

	var got []Project
	if err := json.Unmarshal([]byte(stdout), &got); err != nil {
		t.Fatalf("stdout is not a JSON array: %v\nstdout: %q", err, stdout)
	}
	want := []Project{
		{ID: "p1", TeamID: "t1", Name: "Web & API <prod>", Description: "d1", Visibility: "PRIVATE", CreatedBy: "u1"},
		{ID: "p2", TeamID: "t2", Name: "Staging", Description: "d2", Visibility: "TEAM", CreatedBy: "u2"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("projects = %+v, want %+v", got, want)
	}

	if !strings.HasPrefix(stdout, "[\n  {\n    \"id\": \"p1\"") {
		t.Errorf("stdout is not indented JSON:\n%s", stdout)
	}
	if !strings.Contains(stdout, `"Web & API <prod>"`) {
		t.Errorf("stdout escaped HTML characters in the project name:\n%s", stdout)
	}
	if strings.Contains(stdout, "\x1b[") {
		t.Errorf("stdout contains ANSI escape codes:\n%q", stdout)
	}
}

func TestProjectsListJSONEmptyPrintsEmptyArray(t *testing.T) {
	// An empty array and a JSON null (what a nil Go slice serializes to) must
	// both come out as "[]" so `jq length` works either way.
	for name, body := range map[string]string{"empty array": `[]`, "null": `null`} {
		t.Run(name, func(t *testing.T) {
			stdout, stderr := runProjectsListCmd(t, http.StatusOK, body, "--json")

			if stdout != "[]\n" {
				t.Errorf("stdout = %q, want %q", stdout, "[]\n")
			}
			if !strings.Contains(stderr, "No projects found.") {
				t.Errorf("stderr = %q, want it to contain %q", stderr, "No projects found.")
			}
		})
	}
}

func TestProjectsListJSONErrorKeepsStdoutEmpty(t *testing.T) {
	stdout, stderr := runProjectsListCmd(t, http.StatusInternalServerError, "boom", "--json")

	if stdout != "" {
		t.Errorf("stdout = %q, want empty when the request fails", stdout)
	}
	if !strings.Contains(stderr, "Failed to retrieve projects") || !strings.Contains(stderr, "500") {
		t.Errorf("stderr = %q, want the failure and status code", stderr)
	}
}

func TestProjectsListWithoutFlagStillPrintsTable(t *testing.T) {
	stdout, stderr := runProjectsListCmd(t, http.StatusOK, twoProjectsBody)

	for _, want := range []string{"PROJECT ID", "NAME", "VISIBILITY", "TEAM ID", "p1", "Staging", "TEAM"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("table output is missing %q:\n%s", want, stdout)
		}
	}
	if strings.HasPrefix(strings.TrimSpace(stdout), "[") {
		t.Errorf("table mode printed JSON:\n%s", stdout)
	}
	if stderr != "" {
		t.Errorf("stderr = %q, want empty", stderr)
	}
}

func TestProjectsListWithoutFlagEmptyKeepsInfoMessageOnStdout(t *testing.T) {
	stdout, _ := runProjectsListCmd(t, http.StatusOK, `[]`)

	if !strings.Contains(stdout, "No projects found.") {
		t.Errorf("stdout = %q, want the \"No projects found.\" message", stdout)
	}
}
