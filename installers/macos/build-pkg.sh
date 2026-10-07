#!/usr/bin/env bash
set -euo pipefail

# Builds the universal (amd64+arm64) macOS .pkg installer for the whiparc
# CLI. Installs to /usr/local/bin — already on macOS's default PATH
# (/etc/paths), so no shell-profile editing is needed on this platform.
#
# Must run on an actual macOS machine: pkgbuild/lipo have no Linux/Windows
# equivalent, which is why this is its own CI job (see
# .github/workflows/cli-release.yml) instead of the shared Linux build
# matrix.
#
# Optional code signing + notarization (without it macOS Gatekeeper blocks the
# downloaded .pkg as from an "unidentified developer"). Requires an Apple
# Developer Program membership and two "Developer ID" certificates in the
# keychain on the build machine:
#   APPLE_APPLICATION_IDENTITY  e.g. "Developer ID Application: Name (TEAMID)"
#                               — signs the binary (hardened runtime)
#   APPLE_INSTALLER_IDENTITY    e.g. "Developer ID Installer: Name (TEAMID)"
#                               — signs the .pkg
#   APPLE_NOTARY_KEY_PATH, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER_ID
#                               — App Store Connect API key (.p8) used to
#                                 notarize and staple the signed .pkg
#
# Usage:
#   VERSION=1.2.3 \
#   AMD64_BINARY=./whiparc-darwin-amd64 \
#   ARM64_BINARY=./whiparc-darwin-arm64 \
#   ./installers/macos/build-pkg.sh

: "${VERSION:=0.0.0-dev}"
: "${AMD64_BINARY:?set AMD64_BINARY to the path of the darwin/amd64 build}"
: "${ARM64_BINARY:?set ARM64_BINARY to the path of the darwin/arm64 build}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

ROOT_DIR="$WORK_DIR/root"
mkdir -p "$ROOT_DIR/usr/local/bin"

lipo -create -output "$ROOT_DIR/usr/local/bin/whiparc" "$AMD64_BINARY" "$ARM64_BINARY"
chmod 755 "$ROOT_DIR/usr/local/bin/whiparc"
if [ -n "${APPLE_APPLICATION_IDENTITY:-}" ]; then
  # Notarization requires hardened runtime + a secure timestamp on every
  # executable inside the package.
  codesign --force --options runtime --timestamp \
    --sign "$APPLE_APPLICATION_IDENTITY" "$ROOT_DIR/usr/local/bin/whiparc"
  codesign --verify --strict --verbose=2 "$ROOT_DIR/usr/local/bin/whiparc"
else
  echo "APPLE_APPLICATION_IDENTITY not set — binary will be unsigned"
fi
lipo -info "$ROOT_DIR/usr/local/bin/whiparc"

OUT="whiparc-macos.pkg"
COMPONENT="$WORK_DIR/whiparc-component.pkg"
pkgbuild \
  --root "$ROOT_DIR" \
  --identifier "dev.whiparc.cli" \
  --version "$VERSION" \
  --install-location "/" \
  "$COMPONENT"

# Wrap the component in a distribution package so the installer window can be
# branded (title + logo) — a bare component .pkg has no such UI hooks.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sed "s/@VERSION@/$VERSION/g" "$SCRIPT_DIR/distribution.xml" > "$WORK_DIR/distribution.xml"

PRODUCTBUILD_ARGS=(
  --distribution "$WORK_DIR/distribution.xml"
  --resources "$SCRIPT_DIR/resources"
  --package-path "$WORK_DIR"
)
if [ -n "${APPLE_INSTALLER_IDENTITY:-}" ]; then
  PRODUCTBUILD_ARGS+=(--sign "$APPLE_INSTALLER_IDENTITY" --timestamp)
else
  echo "APPLE_INSTALLER_IDENTITY not set — .pkg will be unsigned"
fi
productbuild "${PRODUCTBUILD_ARGS[@]}" "$OUT"

if [ -n "${APPLE_INSTALLER_IDENTITY:-}" ] && [ -n "${APPLE_NOTARY_KEY_PATH:-}" ]; then
  xcrun notarytool submit "$OUT" \
    --key "$APPLE_NOTARY_KEY_PATH" \
    --key-id "${APPLE_NOTARY_KEY_ID:?set APPLE_NOTARY_KEY_ID}" \
    --issuer "${APPLE_NOTARY_ISSUER_ID:?set APPLE_NOTARY_ISSUER_ID}" \
    --wait
  xcrun stapler staple "$OUT"
  xcrun stapler validate "$OUT"
else
  echo "Notarization skipped (needs APPLE_INSTALLER_IDENTITY + APPLE_NOTARY_KEY_PATH)"
fi

echo "Built $OUT"
