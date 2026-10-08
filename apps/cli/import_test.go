package main

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// buildTree creates the acceptance-criteria fixture: files inside every
// skipped directory, plus files in a normal subfolder, plus two files that
// share a base name in different folders.
func buildTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	files := []string{
		"main.tf",
		"modules/network/main.tf",
		"modules/compute/main.tf", // same base name as modules/network/main.tf
		"env/dev.yml",
		"env/prod.yaml",
		"notes.md", // unsupported extension, must be ignored
		".git/config.tf",
		".git/hooks/pre-commit.yml",
		".terraform/modules/vpc/main.tf",
		".terraform/terraform.tfstate.yml",
		"node_modules/some-pkg/index.tf",
		".github/workflows/ci.yml",
	}

	for _, rel := range files {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("mkdir for %s: %v", rel, err)
		}
		if err := os.WriteFile(full, []byte(rel), 0o644); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}

	return root
}

func collectNames(t *testing.T, root string) []string {
	t.Helper()
	items, err := collectIaCFiles(root)
	if err != nil {
		t.Fatalf("collectIaCFiles: %v", err)
	}
	names := make([]string, 0, len(items))
	for _, it := range items {
		names = append(names, it.Name)
	}
	sort.Strings(names)
	return names
}

// Acceptance criterion 1: only files outside the skipped directories are
// returned.
func TestCollectIaCFilesSkipsIgnoredDirs(t *testing.T) {
	root := buildTree(t)
	got := collectNames(t, root)

	want := []string{
		"env/dev.yml",
		"env/prod.yaml",
		"main.tf",
		"modules/compute/main.tf",
		"modules/network/main.tf",
	}

	if len(got) != len(want) {
		t.Fatalf("got %d files %v, want %d files %v", len(got), got, len(want), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("file %d = %q, want %q (full result: %v)", i, got[i], want[i], got)
		}
	}
}

// Acceptance criterion 3: duplicate base names do not collide, because Name
// is the path relative to the walked directory.
func TestCollectIaCFilesDisambiguatesDuplicateBaseNames(t *testing.T) {
	root := buildTree(t)
	items, err := collectIaCFiles(root)
	if err != nil {
		t.Fatalf("collectIaCFiles: %v", err)
	}

	seen := map[string]int{}
	for _, it := range items {
		seen[it.Name]++
	}
	for name, count := range seen {
		if count > 1 {
			t.Errorf("name %q appeared %d times, want unique names", name, count)
		}
	}

	var network, compute bool
	for _, it := range items {
		switch it.Name {
		case "modules/network/main.tf":
			network = true
		case "modules/compute/main.tf":
			compute = true
		}
	}
	if !network || !compute {
		t.Errorf("expected both main.tf files to be kept distinctly; got %v", seen)
	}
}

// Content must survive the walk unchanged.
func TestCollectIaCFilesKeepsContent(t *testing.T) {
	root := buildTree(t)
	items, err := collectIaCFiles(root)
	if err != nil {
		t.Fatalf("collectIaCFiles: %v", err)
	}
	for _, it := range items {
		if it.Content != it.Name {
			t.Errorf("%s: content = %q, want %q", it.Name, it.Content, it.Name)
		}
	}
}

// Unsupported extensions stay ignored.
func TestCollectIaCFilesIgnoresOtherExtensions(t *testing.T) {
	for _, name := range collectNames(t, buildTree(t)) {
		if filepath.Ext(name) == ".md" {
			t.Errorf("markdown file %q should not be collected", name)
		}
	}
}
