#!/usr/bin/env bash
set -euo pipefail

# Authenticode-signs Windows executables with Jsign (https://ebourg.github.io/jsign/),
# which runs on the Linux CI runner and talks to whichever certificate store
# the publisher uses — a PKCS#12 file, or a cloud/HSM service (SSL.com eSigner,
# DigiCert KeyLocker, Azure Key Vault, Google Cloud KMS, AWS KMS, ...).
#
# Code-signing private keys have had to live on hardware (HSM / token) since
# June 2023, so in practice CI signs through a cloud signing service rather
# than a .pfx. Which one is the maintainer's choice; this script is configured
# purely by environment variables so switching provider needs no code change:
#
#   JSIGN_JAR         path to jsign-<version>.jar (set by the CI install step)
#   JSIGN_STORETYPE   jsign --storetype (PKCS12, ESIGNER, DIGICERTONE, ...)
#   JSIGN_KEYSTORE    jsign --keystore  (file path / service URL / key name)
#   JSIGN_STOREPASS   keystore password or API credential (read via env:, never argv)
#   JSIGN_ALIAS       optional, certificate alias
#   JSIGN_CERTFILE    optional, certificate chain file (.p7b/.pem) for HSM stores
#   JSIGN_TSAURL      optional, RFC 3161 timestamp server
#                     (default: http://timestamp.digicert.com)
#
# Usage: installers/windows/sign.sh <file.exe> [<file.exe> ...]
#
# The RFC 3161 timestamp keeps the signature valid after the certificate
# itself expires, so already-published installers never go stale.

: "${JSIGN_JAR:?set JSIGN_JAR to the path of jsign-<version>.jar}"
: "${JSIGN_STORETYPE:?set JSIGN_STORETYPE (e.g. PKCS12, ESIGNER, DIGICERTONE)}"
: "${JSIGN_KEYSTORE:?set JSIGN_KEYSTORE}"
[ "$#" -ge 1 ] || { echo "usage: $0 <file> [<file> ...]" >&2; exit 2; }

args=(
  --storetype "$JSIGN_STORETYPE"
  --keystore "$JSIGN_KEYSTORE"
  --alg SHA-256
  --tsaurl "${JSIGN_TSAURL:-http://timestamp.digicert.com}"
  --tsmode RFC3161
  --name "Whiparc CLI"
  --url "https://whiparc.com"
)
[ -n "${JSIGN_STOREPASS:-}" ] && args+=(--storepass "env:JSIGN_STOREPASS")
[ -n "${JSIGN_ALIAS:-}" ] && args+=(--alias "$JSIGN_ALIAS")
[ -n "${JSIGN_CERTFILE:-}" ] && args+=(--certfile "$JSIGN_CERTFILE")

for f in "$@"; do
  echo "Signing $f"
  java -jar "$JSIGN_JAR" "${args[@]}" "$f"

  # Fail the build loudly if no signature was actually embedded, rather than
  # shipping an unsigned binary that looks signed in the pipeline logs.
  sig="$(mktemp)"
  if ! osslsigncode extract-signature -in "$f" -out "$sig" >/dev/null 2>&1 || [ ! -s "$sig" ]; then
    echo "::error::$f has no Authenticode signature after signing" >&2
    rm -f "$sig"
    exit 1
  fi
  rm -f "$sig"
  echo "Signed OK: $f"
done
