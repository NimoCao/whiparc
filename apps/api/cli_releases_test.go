package main

import "testing"

func TestPickStableCLIAssetURL(t *testing.T) {
	releases := []cliRelease{
		{Tag: "cli-v0.2.0-beta.1", Prerelease: true, Assets: []cliAsset{{Name: "whiparc-setup-windows-amd64.exe", URL: "https://example.test/beta/setup.exe"}}},
		{Tag: "cli-v0.1.12", Assets: []cliAsset{
			{Name: "whiparc-setup-windows-amd64.exe", URL: "https://example.test/0.1.12/setup.exe"},
			{Name: "whiparc-macos.pkg", URL: "https://example.test/0.1.12/macos.pkg"},
		}},
		{Tag: "cli-v0.1.1", Assets: []cliAsset{{Name: "whiparc-setup-windows-amd64.exe", URL: "https://example.test/0.1.1/setup.exe"}}},
	}

	cases := []struct {
		filename string
		want     string
	}{
		{"whiparc-setup-windows-amd64.exe", "https://example.test/0.1.12/setup.exe"}, // skips the newer prerelease
		{"whiparc-macos.pkg", "https://example.test/0.1.12/macos.pkg"},
		{"does-not-exist", ""},
	}
	for _, tc := range cases {
		if got := pickStableCLIAssetURL(releases, tc.filename); got != tc.want {
			t.Errorf("pickStableCLIAssetURL(%q) = %q, want %q", tc.filename, got, tc.want)
		}
	}

	if got := pickStableCLIAssetURL(nil, "whiparc-macos.pkg"); got != "" {
		t.Errorf("empty release list should yield empty URL, got %q", got)
	}
}
