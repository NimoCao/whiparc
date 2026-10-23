#!/usr/bin/env bash
# Nightly pg_dump -> Cloudflare R2 backup (launch runbook, "Backups & a
# heartbeat" phase) — the concrete fix for Supabase's free tier having no
# automated backups. R2 is S3-compatible, so the AWS CLI talks to it with a
# custom --endpoint-url; no separate R2-specific tooling needed.
#
# Required environment (set in the VM's crontab or as GitHub Actions secrets
# if run from the scheduled workflow instead — see
# .github/workflows/backup-postgres.yml):
#   DATABASE_URL          postgres://... (the same Supabase connection string apps/api uses)
#   R2_ACCOUNT_ID         Cloudflare account ID (R2 endpoint is <account>.r2.cloudflarestorage.com)
#   R2_ACCESS_KEY_ID      R2 API token access key
#   R2_SECRET_ACCESS_KEY  R2 API token secret key
#   R2_BUCKET             destination bucket name
#
# Usage (VM crontab, run nightly):
#   0 3 * * * DATABASE_URL=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... \
#     R2_SECRET_ACCESS_KEY=... R2_BUCKET=... /path/to/backup-postgres.sh >> /var/log/whiparc-backup.log 2>&1
#
#   PG_DUMP               (optional) path to a specific pg_dump binary. Its major
#                         version must be >= the server's (Supabase is on 17.x);
#                         pg_dump aborts on an older client. Defaults to PATH.
#
# Requires: pg_dump (postgresql-client) and the AWS CLI on PATH.
set -euo pipefail

for var in DATABASE_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
	if [ -z "${!var:-}" ]; then
		echo "backup-postgres: $var is not set" >&2
		exit 1
	fi
done

pg_dump_bin="${PG_DUMP:-pg_dump}"

timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
dump_file="/tmp/whiparc-${timestamp}.sql.gz"
trap 'rm -f "$dump_file"' EXIT

echo "backup-postgres: dumping database to ${dump_file} (using $("$pg_dump_bin" --version))"
"$pg_dump_bin" "$DATABASE_URL" --no-owner --no-acl | gzip > "$dump_file"

echo "backup-postgres: uploading to r2://${R2_BUCKET}/backups/whiparc-${timestamp}.sql.gz"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
	aws s3 cp "$dump_file" "s3://${R2_BUCKET}/backups/whiparc-${timestamp}.sql.gz" \
	--endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "backup-postgres: done"
