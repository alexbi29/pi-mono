# Fork operations

This repository, `github.com/alexbi29/pi-mono`, is a fork of pi (upstream: `badlogic/pi-mono`,
mirroring `earendil-works/pi`). This document describes the fork's distribution, the release
pipeline, and how to update pi on every machine. The note in [AGENTS.md](AGENTS.md#fork-operations)
is the entry point.

## What the fork changes

- Thinking-phase stats: the hidden "Thinking..." label ticks elapsed time, then shows
  `TPS 192.1 tok/s. out 160, 0.8s` (estimated or exact reasoning tokens, minimum sampling guard)
  with finished runs coalesced into one label.
- Per-turn usage lines in the transcript (`showTurnUsage` setting).
- Live output rate in the footer while streaming.
- Compact tool call blocks (no blank lines around them).
- Authoritative fork release detection: `pi update` reads the fork's GitHub releases API
  instead of pi.dev, and installs the release tarball (see below).

Fork-only source files (keep patch surface small):

- `packages/coding-agent/src/utils/version-check.ts` - release source + tag/tarball parsing
- `packages/coding-agent/src/package-manager-cli.ts` - self-update installSpec (tarball URL)
- `packages/coding-agent/test/version-check.test.ts` - tests for the above
- `packages/coding-agent/package.json` - `bundledDependencies` (fork metadata, see below)

## Distribution

No npm account, no npm registry publishing. Every fork release:

- builds the coding-agent bundle plus the five workspace packages
  (`pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-mcp`, `pi-tui`) and packs a self-contained
  tarball with them bundled (`bundledDependencies`) - the bundle itself is self-contained at
  runtime, the bundling only satisfies npm metadata because the internal
  `@earendil-works/*@1.4.x` versions do not exist on the registry
- uploads the tarball to a GitHub release on the fork tagged `pi-<version>`
- `pi update` on any machine queries `https://api.github.com/repos/alexbi29/pi-mono/releases/latest`,
  parses the `pi-<version>` tag and the tarball asset URL, and runs
  `npm install -g <tarball-url>` (or pnpm/yarn equivalents).

Do not point this at `raw.githubusercontent.com`: pi gets stale copies there (CDN entries
differ per client), which broke updates. The GitHub API is fresh per request.

## Versioning

Fork versions are always **one patch above the upstream npm version they are based on**
(upstream 1.5.0 -> fork 1.5.1, then 1.5.2, ...). Pre-release suffixes like `1.5.0-fork.1`
sort below the release in semver, so `pi update`'s `isNewerPackageVersion` would never
see them as updates.

## Releasing (run on the Mac, from the pi-mono checkout)

```sh
bash fork-update.sh
```

Reads `@earendil-works/pi-coding-agent` from the npm registry and compares it with the
fork's current version:

- **Upstream published something newer**: fetches `origin`, merges it in, auto-resolving
  fork-only paths (version files take upstream, fork constants stay ours), then bumps all
  workspace packages via `npm run version:` + `sync-versions.js` and regenerates the
  install lock. Any other conflict stops the release with instructions.
- **Fork-only release** (no upstream move): skips the merge, bumps the patch version.

Then: `npm run check`, full build, staging + `npm pack` (workspace siblings bundled),
`gh release create pi-<version>` with the tarball, commit, push `main`. The script is
gitignored and lives only on the Mac; the GitHub releases API is the source of truth.

## Updating pi on machines

```sh
pi update          # pi itself (checks the fork's GitHub releases API)
pi update --extensions
pi --version
```

Current machines and their single canonical pi:

| Machine | Node | pi location | Notes |
|---|---|---|---|
| Mac (here) | mise node 24 | npm global (mise bin) | source checkout + this doc |
| pook.lan | nvm node 25 | `~/.nvm/versions/node/v25.9.0/bin/pi` | nvm on PATH only in interactive shells |
| epyc.lan | system node 22 | `~/.npm-global/bin/pi` | user `.npmrc` prefix is `~/.npm-global` |

There is exactly one pi per machine; a pre-existing upstream install was replaced in place
at its original location on each box. If you ever see two `pi` binaries in `which -a pi`,
the stale one (upstream, without the stats features) wins in some shells - remove it and
`hash -r`.

## Gotchas

- **Non-interactive SSH hides PATH setup**: `ssh host 'node -v'` does not source `.bashrc`,
  so nvm/mise-based tools report "command not found" even though they exist and work in
  interactive shells. Probe with `bash -ic "which pi; pi --version"`.
- **~/.pi is live-synced between machines**: settings (incl. `showTurnUsage`) propagate
  automatically; package installs (`pi install`) do not - run them per machine.
- **A running pi keeps its old code**: restart the session after `pi update`.
- Never run `pip`-adjacent registry tools against `@earendil-works/*` for this fork; the
  internal 1.4.x versions only exist inside our tarballs.
