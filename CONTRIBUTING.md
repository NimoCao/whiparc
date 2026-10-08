# Contributing to Whiparc

Thanks for taking the time to contribute. This document covers how the repo
is organized license-wise, how to get a dev environment running, and the
mechanics of getting a PR merged.

## Before you start: the license split

This repo is **open-core** — not everything in it carries the same license.
Read [NOTICE.md](NOTICE.md) for the full breakdown. Short version:

- `apps/cli/`, `sandbox/`, `spikes/`, and documentation are **MIT** — the
  easiest, lowest-friction place to contribute. No CLA required.
- `apps/web/` and `apps/api/` are **Business Source
  License 1.1** — the core product. PRs touching these paths require
  signing the [Contributor License Agreement](CLA.md); a bot will prompt
  you on your first such PR.

If you're picking your first issue and want the lowest-friction path,
`apps/cli/` and `sandbox/` are the best place to start.

## Development setup

See the [README quickstart](README.md#quickstart) for the short version, or
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for full setup detail (sandbox
containers, OAuth app registration, running each service independently).

## Branching and PRs

- `main` is the release branch — protected, always deployable. What runs on
  whiparc.com is cut from `main`.
- `dev` is the integration branch and this repository's default branch, so a
  plain `git clone` checks out `dev`, which can be ahead of what is deployed.
  Branch from `dev` and PR your feature/fix branches back into `dev`. Use
  `git checkout main` if you want to see what is currently released.
- Branch naming: `feature/<short-description>`, `fix/<short-description>`,
  `docs/<short-description>` (not enforced by tooling, just a convention).
- Keep PRs scoped to one change. Large, multi-purpose PRs are harder to
  review and more likely to get stuck.
- Fill out the PR template — it exists so reviewers don't have to
  reconstruct context you already have.
- CI (`.github/workflows/ci.yml`) must pass: lint + build for the web
  workspace, `go build`/`go vet`/`go test` for each Go module. Run the
  relevant commands locally before pushing:
  ```bash
  # web
  cd apps/web && npm run lint && npm run build

  # any Go module (apps/api, apps/cli)
  cd apps/api && go vet ./... && go test ./...
  ```
- If your PR touches a BSL-licensed path, the CLA check will comment with
  instructions — follow them before requesting review.

## Commit style

New commits should follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) going forward —
this isn't retroactively enforced on existing history, but it makes future
changelog generation possible. Squash-merge is fine; the PR title becomes
the commit message, so make it descriptive.

## Code of Conduct

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). Report concerns to
bishalprasad321@gmail.com.

## How decisions get made

Whiparc currently has one maintainer ([@bishalprasad321](https://github.com/bishalprasad321))
who reviews and merges PRs. As the contributor base grows, component-level
maintainers may be added — see [.github/CODEOWNERS](.github/CODEOWNERS),
which is deliberately structured so a directory can be handed to a new
owner with a one-line change. If you've been consistently contributing to
a specific area and want to take on review responsibility there, open an
issue proposing it.

## Reporting bugs / requesting features

Use the issue templates — they ask for the information that's actually
needed to act on a report (repro steps, environment, expected vs. actual
behavior). Security vulnerabilities go through [SECURITY.md](SECURITY.md)
instead, not a public issue.
