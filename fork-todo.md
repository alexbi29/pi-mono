# Fork TODO

Tracked open items for the pi fork and its machines. See
[FORK-OPERATIONS.md](FORK-OPERATIONS.md) for the setup.

- [x] Switch to `<upstream-base>-<n>` versioning (batched releases, generated
      release notes) and hop all machines to the first new-scheme release
      (1.4.0-1). Done 2026-10.
- [ ] Stress-test `fork-update.sh` ingest mode: run a dry merge against a
      simulated upstream release (tag + version bump) before the first real
      upstream publish exercises it live.
- [ ] Deploy `.pi/extensions/monitor.ts` to pook.lan and epyc.lan
      (`~/.pi/agent/extensions/monitor.ts`) after the manual monitor test passes.
- [ ] Consider removing the superseded `update.sh` (replaced by fork-update.sh).
- [ ] Trace the `~/.pi` live-sync between machines (direction and scope) so
      config drift is predictable.
- [ ] Verify the next batched release includes the thinking-toggle status-line
      removal (committed 2026-10 as `9e599fafc`, shipped with the next fork
      release).
