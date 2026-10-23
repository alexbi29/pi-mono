# Fork TODO

Tracked open items for the pi fork and its machines. See
[FORK-OPERATIONS.md](FORK-OPERATIONS.md) for the setup.

- [ ] Deploy `.pi/extensions/monitor.ts` to pook.lan and epyc.lan
      (`~/.pi/agent/extensions/monitor.ts`) after the manual monitor test passes.
- [ ] Stress-test `fork-update.sh` ingest mode: run a dry merge against a
      simulated upstream release (tag + version bump) before the first real
      upstream publish exercises it live.
- [ ] Add CHANGELOG entries for the 1.4.3 / 1.4.4 fixes (short-trace TPS
      sampling guard; tool-call and user-message blank-line removal).
- [ ] Consider removing the superseded `update.sh` (replaced by fork-update.sh).
- [ ] Trace the `~/.pi` live-sync between machines (direction and scope) so
      config drift is predictable.
