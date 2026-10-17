# Changelog

All notable changes to the Whiparc platform (`apps/web` and `apps/api`) are
recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the platform uses [Semantic Versioning](https://semver.org/). The CLI
(`apps/cli`) is versioned and released separately under `cli-v*` tags.

Releases before 1.0.0 (`v0.x`) are not itemized here; see the
[GitHub tags](https://github.com/whiparc/whiparc/tags).

## [1.0.0] - 2026-10-17

The first production release.

### Added

- Visual canvas with 27 nodes: 2 cloud targets, 6 Terraform resources
  (EC2, security group, S3, RDS, VPC, subnet), 13 Ansible tasks and 6
  Kubernetes objects. Every node compiles to real HCL or YAML.
- Code Preview of the generated files and a ZIP export of the full
  `terraform/`, `ansible/` and `k8s/` bundle.
- Import of existing `.tf` and `.yml` files, and custom nodes authored from
  HCL or YAML.
- Deploy, plan (dry run) and destroy against a local sandbox or your own AWS
  credentials, with live per-node status, streamed logs, and a run history
  that records type, target and who triggered each run.
- Teams, email invites, project roles (Admin, Editor, Viewer), live cursors
  and real-time canvas sync, snapshot history with revert, and an activity
  feed.
- Credential vault (AES-256-GCM) with rotation, expiry and a "test
  connection" check.
- Template catalog: browse, preview, fork, publish your own project, and
  contribute changes back (a contributor submits an edited copy and the
  template's author accepts or rejects it). Reviewers see pending
  contributions on the dashboard and on the template page.
- Email and password sign-in, Google and GitHub login, password reset, email
  change, avatar upload, account deletion, a guided product tour, a command
  palette (Ctrl+K) and searchable docs.
- Release workflows (cut a `release/vX.Y.Z` branch, open the promotion PRs,
  tag and publish on merge to `main`), and a separate dev environment
  (`docker-compose.hosted-dev.yml`, `.env.dev.example`, `dev-api` Caddy
  block).
- Database migration 16 (`template_contributions`) and the
  `TEMPLATE_CURATOR_EMAILS` setting, which lists the accounts allowed to
  review contributions to official templates.

### Changed

- The dashboard "Cloud spend this month" tile no longer shows a made-up
  figure; it shows "Cost estimates coming soon".
- The Publish as Template dialog uses the current design system.
- CI, CodeQL, CLA and PR-title checks also run on `release/**` branches.

### Security

- Access check on the live canvas WebSocket (a signed-in user could join any
  project's room).
- Password policy with a common-password blocklist.
- Rate limiting trusts forwarding headers only from configured proxies.
- Production fail-safes: the API refuses to start with Postgres and no
  `JWT_SECRET` or `FRONTEND_URL`.
- Fixed a CodeQL unsafe-quoting alert in the project import handler.

### Known limitations

- GCP is not ready. A GCP Target can be placed on the canvas but shows "GCP
  cloud support coming soon"; use the AWS Target.
- Sandbox runs need Docker on your machine (`whiparc sandbox up`). A hosted
  sandbox is not available yet.
- There is no cloud cost estimate yet.
- Template contributions are reviewed in-app only; nobody is emailed.
- Official templates can be reviewed only by accounts listed in
  `TEMPLATE_CURATOR_EMAILS`.

[1.0.0]: https://github.com/whiparc/whiparc/releases/tag/v1.0.0
