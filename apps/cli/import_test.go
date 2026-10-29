package main

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// newImportFixture builds a repository-shaped tree: collectable files in normal
// folders, two files sharing a base name, skipped directories at the top level
// and nested, and files that must be ignored (unsupported extensions). Every file's content is its own relative
// path, so tests can check content fidelity.
func newImportFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	files := []string{
		"main.tf",
		"UPPER.TF", // extension match is case-insensitive
		"modules/network/main.tf",
		"modules/compute/main.tf", // same base name as modules/network/main.tf
		"env/dev.yml",
		"env/prod.yaml",

		// Unsupported extensions: never collected.
		"notes.md",
		"prod.tfvars",
		"config.json",

		// Skipped directories at the top level.
		".git/config.tf",
		".git/hooks/pre-commit.yml",
		".terraform/modules/vpc/main.tf",
		".terraform/terraform.tfstate.yml",
		"node_modules/some-pkg/index.tf",
		".github/workflows/ci.yml",

		// Skipped directories nested below a normal one.
		"modules/net/node_modules/x.tf",
		"a/.git/x.yml",
	}

	for _, rel := range files {
		writeFixtureFile(t, root, rel, rel)
	}

	// A directory whose name looks like a Terraform file is a directory, not
	// a file to read; the .tf file inside it is still collected.
	writeFixtureFile(t, root, "x.tf/inside.tf", "x.tf/inside.tf")

	return root
}

func writeFixtureFile(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", rel, err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

func collectNames(t *testing.T, root string) []string {
	t.Helper()
	items, unreadable, err := collectIaCFiles(root)
	if err != nil {
		t.Fatalf("collectIaCFiles: %v", err)
	}
	if len(unreadable) != 0 {
		t.Fatalf("unexpected unreadable files: %v", unreadable)
	}
	names := make([]string, 0, len(items))
	for _, it := range items {
		names = append(names, it.Name)
	}
	sort.Strings(names)
	return names
}

func TestCollectIaCFilesSkipsIgnoredDirsAtAnyDepth(t *testing.T) {
	got := collectNames(t, newImportFixture(t))

	want := []string{
		"UPPER.TF",
		"env/dev.yml",
		"env/prod.yaml",
		"main.tf",
		"modules/compute/main.tf",
		"modules/network/main.tf",
		"x.tf/inside.tf",
	}

	if !reflect.DeepEqual(got, want) {
		t.Errorf("collected files:\n got  %v\n want %v", got, want)
	}
}

// The skip list is matched case-insensitively. This lives in its own tree with
// no lower-case twin: on Windows and macOS "Node_Modules" and "node_modules"
// are the same directory, so mixing them in one fixture would prove nothing.
func TestCollectIaCFilesSkipsIgnoredDirsCaseInsensitively(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "main.tf", "main")
	writeFixtureFile(t, root, "Node_Modules/pkg/y.tf", "y")
	writeFixtureFile(t, root, ".TERRAFORM/z.tf", "z")
	writeFixtureFile(t, root, "sub/.Git/config.yml", "c")

	got := collectNames(t, root)
	want := []string{"main.tf"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("collected files:\n got  %v\n want %v", got, want)
	}
}

func TestCollectIaCFilesKeepsSameNamedFilesDistinct(t *testing.T) {
	items, _, err := collectIaCFiles(newImportFixture(t))
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
	if seen["modules/network/main.tf"] != 1 || seen["modules/compute/main.tf"] != 1 {
		t.Errorf("expected both main.tf files to be kept under their relative paths; got %v", seen)
	}
}

func TestCollectIaCFilesKeepsContent(t *testing.T) {
	items, _, err := collectIaCFiles(newImportFixture(t))
	if err != nil {
		t.Fatalf("collectIaCFiles: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("expected files to be collected")
	}
	for _, it := range items {
		if it.Content != it.Name {
			t.Errorf("%s: content = %q, want %q", it.Name, it.Content, it.Name)
		}
	}
}

// Pointing --dir straight at a directory that carries a skipped name must
// still import its files; only descendants are subject to the skip list.
func TestCollectIaCFilesWalksRootWithSkippedName(t *testing.T) {
	for _, rootName := range []string{".github", ".git", "node_modules", ".terraform", "Node_Modules"} {
		t.Run(rootName, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), rootName)
			writeFixtureFile(t, root, "workflows/ci.yml", "ci")
			writeFixtureFile(t, root, "main.tf", "main")
			writeFixtureFile(t, root, "nested/node_modules/skipped.tf", "skipped")

			got := collectNames(t, root)
			want := []string{"main.tf", "workflows/ci.yml"}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("collected files:\n got  %v\n want %v", got, want)
			}
		})
	}
}

// A symlink named like an IaC file must not pull in whatever it points at,
// whether that is a file outside the tree or one inside it.
func TestCollectIaCFilesIgnoresSymlinks(t *testing.T) {
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("PRIVATE KEY"), 0o600); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	writeFixtureFile(t, root, "real.tf", "real")
	writeFixtureFile(t, root, "inner/target.tf", "target")

	if err := os.Symlink(secret, filepath.Join(root, "leak.tf")); err != nil {
		t.Skipf("cannot create symlinks here (Windows without developer mode?): %v", err)
	}
	if err := os.Symlink(filepath.Join(root, "inner", "target.tf"), filepath.Join(root, "alias.tf")); err != nil {
		t.Skipf("cannot create symlinks here: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "linked-dir.tf")); err != nil {
		t.Skipf("cannot create symlinks here: %v", err)
	}

	items, _, err := collectIaCFiles(root)
	if err != nil {
		t.Fatalf("collectIaCFiles: %v", err)
	}
	for _, it := range items {
		if it.Content == "PRIVATE KEY" {
			t.Fatalf("%s: content from outside the tree was uploaded", it.Name)
		}
	}

	got := collectNames(t, root)
	want := []string{"inner/target.tf", "real.tf"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("collected files:\n got  %v\n want %v", got, want)
	}
}

func TestCollectIaCFilesEmptyAndMissingDir(t *testing.T) {
	t.Run("empty directory is not an error", func(t *testing.T) {
		items, unreadable, err := collectIaCFiles(t.TempDir())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(items) != 0 || len(unreadable) != 0 {
			t.Errorf("got %d files and %d unreadable, want none", len(items), len(unreadable))
		}
	})

	t.Run("missing directory is an error", func(t *testing.T) {
		if _, _, err := collectIaCFiles(filepath.Join(t.TempDir(), "does-not-exist")); err == nil {
			t.Fatal("expected an error for a missing directory")
		}
	})
}
