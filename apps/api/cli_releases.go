package main

// GET /api/cli/releases powers the docs site's install-guide version picker
// (apps/web/app/docs/page.tsx) — a small, cached proxy over GitHub's
// Releases API so the docs page doesn't call GitHub directly from every
// visitor's browser (GitHub's unauthenticated rate limit is per-IP, and a
// server-side proxy shares one budget across all visitors instead of
// spending it per-visitor... which is itself why this caches: even the
// server's own shared budget is 60 req/hr unauthenticated, so a request per
// page load would exhaust it quickly under any real traffic).

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// cliReleaseTagPattern matches real version tags (cli-v1.2.3, optionally
// with a semver prerelease suffix like cli-v1.2.3-beta.1) and excludes the
// rolling `cli-latest` tag, which isn't a version.
var cliReleaseTagPattern = regexp.MustCompile(`^cli-v\d+\.\d+\.\d+`)

const cliReleasesCacheTTL = 5 * time.Minute

var (
	cliReleasesMu       sync.Mutex
	cliReleasesCache    []byte
	cliReleasesCachedAt time.Time
)

type cliAsset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Size int64  `json:"size"`
}

type cliRelease struct {
	Version     string     `json:"version"`
	Tag         string     `json:"tag"`
	PublishedAt string     `json:"publishedAt"`
	Prerelease  bool       `json:"prerelease"`
	HTMLURL     string     `json:"htmlUrl"`
	Assets      []cliAsset `json:"assets"`
}

func handleGetCLIReleases(w http.ResponseWriter, r *http.Request) {
	body, err := getCLIReleasesBody()
	if err != nil {
		http.Error(w, "Failed to fetch CLI releases", http.StatusServiceUnavailable)
		return
	}
	writeCLIReleasesResponse(w, body)
}

// getCLIReleasesBody returns the marshaled release list, serving it from the
// in-memory cache while fresh and falling back to a stale copy if GitHub is
// unreachable or rate-limiting us.
func getCLIReleasesBody() ([]byte, error) {
	cliReleasesMu.Lock()
	fresh := len(cliReleasesCache) > 0 && time.Since(cliReleasesCachedAt) < cliReleasesCacheTTL
	cached := cliReleasesCache
	cliReleasesMu.Unlock()

	if fresh {
		return cached, nil
	}

	body, err := fetchAndBuildCLIReleases()
	if err != nil {
		log.Printf("[CLI RELEASES] fetch failed: %v", err)
		// Serve a stale cache over a hard failure — a slightly outdated
		// version list is far better UX than a broken picker, especially
		// against GitHub's unauthenticated rate limit.
		cliReleasesMu.Lock()
		stale := cliReleasesCache
		cliReleasesMu.Unlock()
		if len(stale) > 0 {
			return stale, nil
		}
		return nil, err
	}

	cliReleasesMu.Lock()
	cliReleasesCache = body
	cliReleasesCachedAt = time.Now()
	cliReleasesMu.Unlock()

	return body, nil
}

// latestStableCLIAssetURL returns the download URL of the named asset on the
// newest stable (non-prerelease) cli-v* Release. It exists because GitHub's
// own "latest" shortcuts are repo-wide and can point at a non-CLI platform
// Release (v1.0.x) that has no installer assets. Returns "" when no stable
// CLI release carries the asset or the release list is unavailable, so
// callers can fall back to a static URL.
func latestStableCLIAssetURL(filename string) string {
	body, err := getCLIReleasesBody()
	if err != nil {
		return ""
	}
	var releases []cliRelease
	if err := json.Unmarshal(body, &releases); err != nil {
		return ""
	}
	return pickStableCLIAssetURL(releases, filename)
}

// pickStableCLIAssetURL expects releases newest-first (as
// fetchAndBuildCLIReleases returns them).
func pickStableCLIAssetURL(releases []cliRelease, filename string) string {
	for _, rel := range releases {
		if rel.Prerelease {
			continue
		}
		for _, a := range rel.Assets {
			if a.Name == filename {
				return a.URL
			}
		}
	}
	return ""
}

func writeCLIReleasesResponse(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(body)
}

// fetchAndBuildCLIReleases calls GitHub's Releases API once, filters to
// real whiparc CLI version tags, and returns the already-JSON-marshaled
// response body this endpoint serves (and caches).
func fetchAndBuildCLIReleases() ([]byte, error) {
	req, err := http.NewRequest("GET", "https://api.github.com/repos/whiparc/whiparc/releases?per_page=50", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	// Optional: raises GitHub's rate limit from 60/hr to 5000/hr. Fine to
	// run unauthenticated at low traffic; set GITHUB_TOKEN in production
	// once real usage approaches the unauthenticated ceiling.
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("github releases API returned status %d", resp.StatusCode)
	}

	var raw []struct {
		TagName     string `json:"tag_name"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
		PublishedAt string `json:"published_at"`
		HTMLURL     string `json:"html_url"`
		Assets      []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	releases := make([]cliRelease, 0, len(raw))
	for _, rel := range raw {
		if rel.Draft || !cliReleaseTagPattern.MatchString(rel.TagName) {
			continue
		}
		assets := make([]cliAsset, 0, len(rel.Assets))
		for _, a := range rel.Assets {
			assets = append(assets, cliAsset{Name: a.Name, URL: a.BrowserDownloadURL, Size: a.Size})
		}
		releases = append(releases, cliRelease{
			Version:     strings.TrimPrefix(rel.TagName, "cli-v"),
			Tag:         rel.TagName,
			PublishedAt: rel.PublishedAt,
			Prerelease:  rel.Prerelease,
			HTMLURL:     rel.HTMLURL,
			Assets:      assets,
		})
	}

	// GitHub already returns releases newest-first, but sort explicitly
	// rather than depending on that being true forever.
	sort.Slice(releases, func(i, j int) bool {
		return releases[i].PublishedAt > releases[j].PublishedAt
	})

	return json.Marshal(releases)
}
