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
- [x] Deploy the monitor extension: `~/.pi/agent/extensions/monitor.ts` on
      pook.lan and epyc.lan (verified via headless probe); the Mac uses the
      project copy `.pi/extensions/monitor.ts` (repo cwd; an agent-level copy
      on the Mac conflicts with it). Done 2026-10.
- [ ] Trace the `~/.pi` live-sync between machines (direction and scope) so
      config drift is predictable.
- [ ] Verify the next batched release includes the thinking-toggle status-line
      removal (committed 2026-10 as `9e599fafc`, shipped with the next fork
      release).
