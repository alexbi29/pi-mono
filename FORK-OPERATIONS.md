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

Fork versions are `<upstream-base>-<n>`: the first fork release on upstream
1.5.0 is `1.5.0-1`, then `1.5.0-2`, ... After ingesting upstream 1.6.0, the
next release is `1.6.0-1` (the counter restarts on a fresh base). Numeric
prerelease identifiers compare numerically in semver, so the fork chain always
upgrades (`1.5.0-1 < 1.5.0-2 < ... < 1.6.0-1`) and never exhausts (letters
would stop at `z`; `-aa` sorts below `-z`).

`pi update`'s version check compares against the installed version, so a
machine on the fork chain upgrades automatically. A machine on a pre-scheme
release (old patch+1 numbering like 1.4.x) cannot see `1.4.0-1` as newer
(`1.4.x > 1.4.0-1` by semver) - the first new-scheme release needs one manual
hop per machine: `npm install -g <tarball-url>` (done once during the switch).

Pre-release suffixes sort below the release, so a machine on pure upstream
`1.5.0` (never reached through our distribution) would not be offered
`1.5.0-1` - irrelevant in practice since our binaries only come from our
releases.

## Syncing upstream main between releases

`fork-update.sh` ingests upstream only when its npm version moves above the fork
base. Upstream `main` can move ahead without a publish (pre-release commits; the
11-commit sync of 2026-11 is the reference case). To stay current without
releasing:

```sh
git fetch origin
git rev-list --count HEAD..origin/main   # 0 -> nothing to do
git merge --no-edit origin/main
npm run check
git push fork main
```

Plain `git merge`; no auto-resolution runs. Fork-only paths and the fork version
metadata (`1.4.0-1`) stay ours; on a conflict in a fork-only path
(`version-check.ts`, `package-manager-cli.ts`, `version-check.test.ts`), take
`--ours`. If the merge conflicts on version-carrying files (any `package.json`,
lockfiles, `packages/ai/src/utils/version.ts`), upstream has probably just
published - abort and run `bash fork-update.sh` instead, which ingests with
`--theirs` and re-bumps to `<new-base>-1`.

A manual sync does not disturb the pipeline: the next publish-time ingest merges
on top of it, the version-file conflict against the new upstream version resolves
with `--theirs` + re-bump as usual, and the synced upstream commits appear in the
next release notes alongside the fork changes (notes use `git log --no-merges
<last-pi-tag>..HEAD`).

## Releasing (run on the Mac, from the pi-mono checkout)

```sh
bash fork-update.sh
```

Releases are **batched**: run the script when upstream publishes, or when fork
changes have accumulated - not per change. The script reads
`@earendil-works/pi-coding-agent` from the npm registry, determines the base
and next fork version as above, and:

- **Upstream published something newer** (newer than our base): fetches
  `origin`, merges it in, auto-resolving fork-only paths (version files take
  upstream, fork constants stay ours), and resets the counter
  (`upstream-1`). Any other conflict stops the release with instructions.
- **Fork-only release** (no upstream move): increments the counter
  (`base-n+1`).

Then: `npm run check`, full build, staging + `npm pack` (workspace siblings
bundled), release notes, `gh release create pi-<version>` with the tarball,
commit, push `main`.

Release notes are generated: the ingested upstream's `## [X.Y.Z]` changelog
section when there was an ingest, plus the fork commits since the previous
`pi-*` tag. The script is gitignored and lives only on the Mac; the GitHub
releases API is the source of truth.

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
