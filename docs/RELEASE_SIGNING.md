# CLI Release Signing

This document covers code signing for the Whiparc CLI installers produced by
[`.github/workflows/cli-release.yml`](../.github/workflows/cli-release.yml). It is
written for maintainers who hold the repository secrets.

## Why users see warnings today

| Platform | Artifact | Warning when unsigned |
| --- | --- | --- |
| Windows | `whiparc-setup-windows-amd64.exe`, `whiparc-windows-amd64.exe` | Microsoft Defender SmartScreen: "Windows protected your PC", publisher "Unknown publisher" |
| macOS | `whiparc-macos.pkg` | Gatekeeper: package cannot be opened because it is from an unidentified developer / cannot be verified |
| Linux | `.deb`, `.rpm`, raw binary | No OS-level gate. Integrity is covered by `SHA256SUMS.txt` attached to every release |

The pipeline is already wired to sign and notarize. It stays inert until the
secrets below exist, and a tagged release (`cli-v*`) logs a `::warning::` for
each artifact that shipped unsigned.

Signing only runs on `push` events (`main` and `cli-v*` tags). Pull request runs
never receive signing credentials, so a modified workflow in a PR cannot sign
anything with the production certificate.

## Windows (Authenticode)

### What to expect from SmartScreen

A valid Authenticode signature replaces "Unknown publisher" with the verified
publisher name, which is necessary for SmartScreen to treat the file as
trustworthy. It does not guarantee the warning disappears on day one:
SmartScreen reputation accrues per publisher identity over time and download
volume, so keep signing every release with the same certificate identity.
Extended Validation certificates no longer bypass this by themselves.

### Choosing a certificate provider

Since June 2023 the private key of any publicly trusted code-signing
certificate must live in a FIPS-validated hardware module. A `.pfx` file cannot
be used for new certificates, and a USB token cannot be plugged into a
GitHub-hosted runner, so CI signing requires a provider that exposes the key
through a cloud signing API.

| Option | Notes |
| --- | --- |
| OV certificate from a CA with a cloud signing service (SSL.com eSigner, DigiCert KeyLocker, and similar) | Works anywhere the CA validates the organization or individual. Supported by Jsign (`ESIGNER`, `DIGICERTONE`). |
| OV/EV certificate with the key in a cloud KMS (Azure Key Vault, Google Cloud KMS, AWS KMS) | Supported by Jsign (`AZUREKEYVAULT`, `GOOGLECLOUD`, `AWS`). |
| Azure Artifact Signing (formerly Trusted Signing) | Low cost and first-party, but identity validation is limited to organizations in the USA, Canada, EU and UK, and individuals in the USA and Canada. Supported by Jsign (`TRUSTEDSIGNING`). Needs a short-lived access token, so it needs an extra login step in the workflow. |
| SignPath Foundation | Free, but requires every component of the project to be under an OSI-approved license. The repository root is BSL 1.1, so the project does not qualify as a whole. |

The signer is [Jsign](https://ebourg.github.io/jsign/), driven by
[`installers/windows/sign.sh`](../installers/windows/sign.sh). It runs on the
existing Linux jobs, so no Windows runner is needed. Consult the Jsign
documentation for the exact `--keystore` / `--storepass` format of the chosen
`storetype`.

### Repository secrets

| Secret | Purpose |
| --- | --- |
| `JSIGN_STORETYPE` | Jsign `--storetype`. Its presence turns Windows signing on. |
| `JSIGN_KEYSTORE` | Jsign `--keystore` (service URL, key name or file path). |
| `JSIGN_STOREPASS` | Password or API credential. Passed to Jsign through an environment variable, never on the command line. |
| `JSIGN_ALIAS` | Optional certificate alias. |
| `JSIGN_CERTFILE_B64` | Optional base64 of the certificate chain (PEM or `.p7b`), needed by some HSM-backed stores. |

Both the CLI binary (signed in the `build` job, before it is published or
embedded) and the NSIS installer (signed in `package-windows-linux`) are signed
with an RFC 3161 timestamp, so signatures stay valid after the certificate
expires. The job fails if a signature is not present after signing.

### Verify a release

```powershell
Get-AuthenticodeSignature .\whiparc-setup-windows-amd64.exe | Format-List Status, SignerCertificate
Get-AuthenticodeSignature .\whiparc-windows-amd64.exe       | Format-List Status, SignerCertificate
```

`Status` must be `Valid`.

## macOS (Developer ID and notarization)

Requires an Apple Developer Program membership. Create two certificates in the
developer portal, **Developer ID Application** (signs the binary) and
**Developer ID Installer** (signs the `.pkg`), export both from Keychain Access
into a single `.p12`, and create an App Store Connect API key (`.p8`) for
notarization.

| Secret | Purpose |
| --- | --- |
| `MACOS_CERTS_P12_BASE64` | Base64 of the `.p12` containing both certificates. Its presence turns macOS signing on. |
| `MACOS_CERTS_P12_PASSWORD` | Password of that `.p12`. |
| `MACOS_APPLICATION_IDENTITY` | Full name, e.g. `Developer ID Application: Example Ltd (TEAMID)`. |
| `MACOS_INSTALLER_IDENTITY` | Full name, e.g. `Developer ID Installer: Example Ltd (TEAMID)`. |
| `APPLE_NOTARY_KEY_BASE64` | Base64 of the App Store Connect API key `.p8`. |
| `APPLE_NOTARY_KEY_ID` | API key ID. |
| `APPLE_NOTARY_ISSUER_ID` | API issuer ID. |

[`installers/macos/build-pkg.sh`](../installers/macos/build-pkg.sh) signs the
binary with the hardened runtime, builds and signs the package, submits it to
Apple's notary service, and staples the ticket.

Verify a release:

```bash
pkgutil --check-signature whiparc-macos.pkg
xcrun stapler validate whiparc-macos.pkg
spctl --assess --type install -v whiparc-macos.pkg
```

## Linux

Every release carries `SHA256SUMS.txt`:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
```

Detached GPG signatures for the `.deb` and `.rpm` packages (via nfpm's
`signature` settings) can be added later if a signed package repository is
published.

## Installer icons

All icons are generated from the brand mark
(`apps/web/public/icons/icon-512.png`) by
[`installers/generate-icons.py`](../installers/generate-icons.py):

| Platform | Output | Used by |
| --- | --- | --- |
| Windows | `installers/windows/whiparc.ico` (BMP frames, 16 to 256 px) | NSIS installer and uninstaller icon, embedded in `whiparc.exe` through go-winres (`apps/cli/winres/winres.json`) |
| Linux | `installers/linux/icons/` (hicolor PNG sizes plus SVG) and `whiparc.desktop` | `.deb` / `.rpm` application menu entry |
| macOS | `installers/macos/resources/background.png` | Installer window branding. macOS does not allow a custom Finder icon on a `.pkg` file itself |

Re-run the script (`pip install pillow`) after changing the source icon.
