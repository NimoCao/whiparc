# syntax=docker/dockerfile:1.7

# Which published tag of whiparc-runner-base to build on top of. Tracks the
# dev-branch build by default, so local builds pick up base-image changes as
# soon as they land on dev. Requires publish-base-image.yml to have actually
# published a `:dev` tag — until then this fails to resolve. Override with
# `--build-arg BASE_IMAGE_TAG=latest` (or `=main`) for a production-style
# build.
ARG BASE_IMAGE_TAG=dev

# Build context is the repo root (see docker-compose.yml) so this stage can
# also reach apps/cli — the final image needs the whiparc CLI binary on
# PATH for the local_agent SSH ProxyCommand bridge (see runner.go's
# cliHelperPath(), and obsidian_memory/08.4's Phase 1).
#
# apps/api and apps/cli are independent Go modules (no shared code), so they
# build in two separate stages below instead of one sequential stage — with
# BuildKit that lets them compile concurrently. Each stage also gets its own
# cache mounts for the Go module/build cache: those persist across builds
# regardless of layer invalidation, so editing one .go file no longer forces
# recompiling every dependency from scratch on the next `docker compose up
# --build`.
FROM golang:1.25 AS gobase
WORKDIR /src

# Both apps/api and apps/cli are independent Go modules that may require a
# newer toolchain than this pinned `golang:1.23` base image ships (each
# module's own go.mod `go` directive can be bumped independently, e.g. by a
# Dependabot PR touching only one module). The golang base image ships with
# GOTOOLCHAIN=local (no auto download), so it's explicitly overridden to
# `auto` on every `go mod download`/`go build` below, on the default GOPROXY
# (not GOPROXY=direct, which doesn't serve toolchain downloads), so `go`
# fetches whatever toolchain each module's go.mod declares. That downloaded
# toolchain lands in the module cache mount, so it's fetched once per module.
FROM gobase AS builder-api
COPY apps/api/go.mod apps/api/go.sum ./apps/api/
RUN --mount=type=cache,target=/go/pkg/mod,id=gomod-api \
    cd apps/api && GOTOOLCHAIN=auto go mod download
COPY apps/api ./apps/api
RUN --mount=type=cache,target=/go/pkg/mod,id=gomod-api \
    --mount=type=cache,target=/root/.cache/go-build,id=gobuild-api \
    cd apps/api && GOTOOLCHAIN=auto CGO_ENABLED=0 GOOS=linux go build -o /out/api-server .

FROM gobase AS builder-cli
COPY apps/cli/go.mod apps/cli/go.sum ./apps/cli/
RUN --mount=type=cache,target=/go/pkg/mod,id=gomod-cli \
    cd apps/cli && GOTOOLCHAIN=auto go mod download
COPY apps/cli ./apps/cli
RUN --mount=type=cache,target=/go/pkg/mod,id=gomod-cli \
    --mount=type=cache,target=/root/.cache/go-build,id=gobuild-cli \
    cd apps/cli && GOTOOLCHAIN=auto CGO_ENABLED=0 GOOS=linux go build -o /out/whiparc .

# Pull prebuilt tools baseline from GHCR (installs nothing locally)
FROM ghcr.io/whiparc/whiparc-runner-base:${BASE_IMAGE_TAG}
ENV IS_DOCKER=true
ENV PORT=8080

WORKDIR /app
COPY --link --from=builder-api /out/api-server .
COPY --link --from=builder-cli /out/whiparc /usr/local/bin/whiparc
RUN chmod +x /usr/local/bin/whiparc

EXPOSE 8080
CMD ["./api-server"]
