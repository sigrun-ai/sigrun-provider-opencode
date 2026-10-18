# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-18
### Added
- Sigrun provider plugin: OpenCode's paid Go tier
  (`https://opencode.ai/zen/go/v1`) as one dynamic OpenAI-compatible
  provider (`provider: "opencode"` stamped on every catalog entry so
  persisted catalogs survive cold-boot restore). The `/zen/v1` free tier
  is client-gated and out of scope.
- Provider-only contributor factory: `{ name: "sigrun-opencode",
  providers: [{ provider, readiness }], health }` — no pi-durable
  extension surface.
- Credential resolution through sigrun's auth.json bridge with
  `OPENCODE_GO_API_KEY` as the ambient fallback (bridge credential
  always wins).
- Three-state readiness tracker (`not_configured` / `degraded` /
  `ready`) seeded from credential resolution and updated per refresh
  outcome; `console.warn` on state transitions only. `health()` maps
  `not_configured` to `"ok"` and configured-and-failing to
  `"degraded"`.
- `fetchModels` throws on unconfigured and on failure — never returns
  `[]` (an empty array would publish and wipe the persisted catalog).
