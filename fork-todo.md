# Fork TODO

Tracked open items for the pi fork and its machines. See
[FORK-OPERATIONS.md](FORK-OPERATIONS.md) for the setup.

## Weekly routine

- [ ] **Weekly** — check upstream npm: `npm view @earendil-works/pi-coding-agent version`
      vs the fork base (`packages/coding-agent/package.json`), and upstream `main`
      movement: `git fetch origin && git rev-list --count HEAD..origin/main`. If npm
      moved above the base, or fork changes have accumulated, run `bash fork-update.sh`,
      then `pi update` on all machines (Mac, pook.lan, epyc.lan) and verify the release
      notes cover the upstream changelog section. If only `main` moved, sync manually
      (no release) per FORK-OPERATIONS.md, "Syncing upstream main between releases".

## Backlog

- [x] Switch to `<upstream-base>-<n>` versioning (batched releases, generated
      release notes) and hop all machines to the first new-scheme release
      (1.4.0-1). Done 2026-10.
- [ ] First real upstream publish: watch the ingest path's version takeover
      (`--theirs` on version files) and re-bump to `<new-base>-1` live. The merge
      half was exercised by the manual sync of 11 pre-release commits on 2026-11
      (clean, no auto-resolution needed).
- [x] Fork telemetry policy (2026-11): no telemetry anywhere in shipped code.
      `packages/ai` vendors an inert telemetry contract
      (`packages/ai/src/telemetry-contract.ts`, no `pi-telemetry` dependency),
      and install telemetry is disabled (`isInstallTelemetryEnabled` always
      false, `reportInstallTelemetry` a no-op). Adapted
      `sdk-client-identity.test.ts` accordingly: the CLI-agent identity test now
      expects no attribution headers even with the telemetry setting enabled.
- [x] Deploy the monitor extension: `~/.pi/agent/extensions/monitor.ts` on
      pook.lan and epyc.lan (verified via headless probe); the Mac uses the
      project copy `.pi/extensions/monitor.ts` (repo cwd; an agent-level copy
      on the Mac conflicts with it). Done 2026-10.
- [ ] Trace the `~/.pi` live-sync between machines (direction and scope) so
      config drift is predictable.
- [x] Verify the next batched release includes the thinking-toggle status-line
      removal (committed 2026-10 as `9e599fafc`). Shipped in 1.4.0-2.
- [x] Adapt the upstream tests that assumed upstream's own update source and
      spacing (they failed on the fork: 13 tests under `./test.sh`). Done 2026-11:
      `package-command-paths.test.ts` now mocks the fork's GitHub releases shape
      (tarball asset, no `packageName`) via `mockForkReleaseFetch`, and
      `user-message.test.ts` covers the fork's flush single-line layout. That
      surfaced a real bug: with the flush layout the OSC-133 closing markers were
      emitted *before* the opening one (`B, C, A`), so a one-line user message
      carried a malformed shell-integration zone; order is now `A, B, C`.
      Remaining `./test.sh` failures are only the 6 `packages/env` suites, which
      need `npm run build:daemon` (Rust, as CI does).
- [x] Install cargo on the Mac so `packages/env`'s daemon suites run. Done 2026-11:
      rustup (minimal profile, 1.99.1) in `~/.cargo`, with `cargo`/`rustc`/`rustup`
      symlinked into `~/.local/bin` so non-interactive script shells - which do not
      source `~/.profile` - see them too. `./test.sh` is fully green there now.
- [ ] Upstream's `footer-data-provider` reftable test polls with a fixed timeout and
      can fail under heavy load on the Mac (passes in isolation). Ignore it only
      after re-running on an idle machine.
