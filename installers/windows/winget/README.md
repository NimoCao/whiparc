# winget package for the Whiparc CLI

These three files are the [Windows Package Manager](https://learn.microsoft.com/en-us/windows/package-manager/)
manifest for package `Whiparc.CLI`. winget downloads the installer itself, so
the file never carries the browser "Mark of the Web" and Windows SmartScreen
does not show "Windows protected your PC" for `winget install` users. It is a
free alternative to a paid code-signing certificate for command-line users;
people downloading the `.exe` from a browser are not covered (see
[docs/RELEASE_SIGNING.md](../../../docs/RELEASE_SIGNING.md)).

| File | Purpose |
| --- | --- |
| `manifests/Whiparc.CLI.yaml` | Version manifest |
| `manifests/Whiparc.CLI.installer.yaml` | Installer URL, SHA-256, NSIS silent switch (`/S`), per-user scope |
| `manifests/Whiparc.CLI.locale.en-US.yaml` | Name, publisher, license, description, tags |

The installer manifest describes the per-user NSIS installer built from
`installers/windows/whiparc.nsi`. `ProductCode: Whiparc` is the name of the
uninstall registry key that script writes; if either changes, change both.

## First submission (manual, once)

The automation below can only update a package that already exists in
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), so the first
version is submitted by hand. Prefer a release built after the icon and
signing work in this repository (the checked-in manifest points at
`cli-v0.1.1`).

1. Fork `microsoft/winget-pkgs` on GitHub.
2. Create a classic personal access token with the `public_repo` scope.
3. From a Windows machine, with the release assets already published:

   ```powershell
   winget install Microsoft.WingetCreate
   wingetcreate new https://github.com/whiparc/whiparc/releases/download/cli-vX.Y.Z/whiparc-setup-windows-amd64.exe
   ```

   Use the checked-in manifests as the reference for each answer (identifier
   `Whiparc.CLI`), or validate and submit them directly:

   ```powershell
   winget validate --manifest installers/windows/winget/manifests
   wingetcreate submit --token <PAT> installers/windows/winget/manifests
   ```

4. Microsoft's validation pipeline scans the installer and a maintainer reviews
   the pull request. Unsigned installers are accepted, but a Defender false
   positive on a freshly built NSIS installer can hold the review; reply on the
   pull request if that happens.

## Automatic updates

After the first version is merged, add a repository secret named
`WINGET_TOKEN` (the same kind of token as above). On every stable `cli-v*` tag,
the `winget` job in `.github/workflows/cli-release.yml` runs
`wingetcreate update` and opens the version-bump pull request automatically.
Prereleases (tags containing `-`) are skipped. Without the secret the job only
logs a warning.

## Test a manifest locally

Local manifest installs are disabled by default; enable them once from an
elevated shell, then:

```powershell
winget settings --enable LocalManifestFiles
winget install --manifest installers/windows/winget/manifests
whiparc --version
winget uninstall Whiparc.CLI
```
