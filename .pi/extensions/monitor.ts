/**
 * Background monitors.
 *
 * Registers a shell check that runs every N seconds in the background and
 * notifies the user when the condition changes. Use this instead of
 * sleep-polling loops for conditions that take longer than ~10s (builds,
 * deployments, server readiness, file arrival).
 *
 * Tools:
 *   monitor         register a periodic check; returns immediately
 *   monitor_status  list active monitors and their last result
 *   monitor_stop    stop one monitor, or all
 */

import { exec } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MIN_INTERVAL_SECONDS = 10;
const MAX_MONITORS = 8;
const MAX_OUTPUT_CHARS = 2000;
const MAX_TIMEOUT_SECONDS = 60;

type MonitorStatus = "pending" | "success" | "fail" | "timeout" | "stopped";

interface Monitor {
	id: string;
	task: string;
	command: string;
	intervalMs: number;
	timeoutMs: number;
	notifyOn: "change" | "success" | "fail";
	report: boolean;
	status: MonitorStatus;
	lastOutput: string;
	lastError?: string;
	lastRunAt?: number;
	running: boolean;
	timer: NodeJS.Timeout;
}

const monitors = new Map<string, Monitor>();
let shutdown = false;

// Installed on the first monitor tool call; ui.notify needs a live session
// context and is absent in headless runs.
let notifyFn: ((message: string, type: "info" | "warning") => void) | undefined;
// Wakes the agent (sendUserMessage always triggers a turn) so it can report
// the condition, Claude Code monitor style.
let wakeAgent: ((text: string) => void) | undefined;

function runCheck(monitor: Monitor, cwd: string): void {
	if (monitor.running || shutdown) return;
	monitor.running = true;
	exec(
		monitor.command,
		{
			cwd,
			shell: "/bin/bash",
			timeout: monitor.timeoutMs,
			maxBuffer: 64 * 1024,
			env: { ...process.env, LANG: "C" },
		},
		(error, stdout, stderr) => {
			monitor.running = false;
			monitor.lastRunAt = Date.now();
			const previous = monitor.status;
			if (error && error.killed) {
				monitor.status = "timeout";
				monitor.lastOutput = `${stdout}\n${stderr}`.trim().slice(-MAX_OUTPUT_CHARS);
				monitor.lastError = `timed out after ${monitor.timeoutMs / 1000}s`;
			} else if (error) {
				monitor.status = "fail";
				monitor.lastOutput = `${stdout}\n${stderr}`.trim().slice(-MAX_OUTPUT_CHARS);
				monitor.lastError = `exit ${error.code ?? "?"}`;
			} else {
				monitor.status = "success";
				monitor.lastOutput = stdout.trim().slice(-MAX_OUTPUT_CHARS);
				monitor.lastError = undefined;
			}
			appendLogMonitor(cwd, monitor);
			maybeNotify(monitor, previous);
		},
	);
}

function maybeNotify(monitor: Monitor, previous: MonitorStatus): void {
	const notify =
		monitor.notifyOn === "success"
			? monitor.status === "success" && previous !== "success"
			: monitor.notifyOn === "fail"
				? monitor.status === "fail" && previous !== "fail"
				: // "change": first result, and any status flip (incl. recovery)
					monitor.status !== previous;
	if (!notify) return;
	const firstLine = monitor.lastOutput.split("\n")[0]?.trim() ?? "";
	const detail = firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
	const suffix = detail ? ` — ${detail}` : "";
	const type = monitor.status === "fail" || monitor.status === "timeout" ? "warning" : "info";
	try {
		if (notifyFn) notifyFn(`${monitor.task} → ${monitor.status}${suffix}`, type);
	} catch {
		// never throw from the timer callback
	}
	// Headless runs have no UI: the log line is the only visible trail.
	try {
		// eslint-disable-next-line no-console
		console.log(`[monitor:${monitor.id}] ${monitor.task} → ${monitor.status}${suffix}`);
	} catch {
		// never throw from the timer callback
	}
	// Wake the agent to report the flip; it gets queued if a turn is running.
	if (monitor.report) {
		try {
			if (wakeAgent) wakeAgent(`[monitor] ${monitor.task} → ${monitor.status}${suffix}`);
		} catch {
			// never throw from the timer callback
		}
	}
}

function appendLog(
	cwd: string,
	entry: { id: string; task: string; status: string; lastOutput: string; lastError?: string },
): void {
	try {
		const dir = join(cwd, ".pi");
		mkdirSync(dir, { recursive: true });
		appendFileSync(
			join(dir, "monitors.jsonl"),
			`${JSON.stringify({
				ts: new Date().toISOString(),
				id: entry.id,
				task: entry.task,
				status: entry.status,
				error: entry.lastError ?? null,
				output: entry.lastOutput.slice(0, 500),
			})}\n`,
		);
	} catch {
		// logging must never break the monitor
	}
}

function appendLogMonitor(cwd: string, monitor: Monitor): void {
	appendLog(cwd, {
		id: monitor.id,
		task: monitor.task,
		status: monitor.status,
		lastOutput: monitor.lastOutput,
		lastError: monitor.lastError,
	});
}

export default function (pi: ExtensionAPI) {
	wakeAgent = (text) => {
		try {
			pi.sendUserMessage(text);
		} catch {
			// agent busy, session gone, or headless run
		}
	};
	pi.on("session_shutdown", () => {
		shutdown = true;
		for (const monitor of monitors.values()) {
			clearInterval(monitor.timer);
		}
		monitors.clear();
	});

	pi.registerTool({
		name: "monitor",
		label: "monitor",
		description:
			"Register a background check that runs a shell command every N seconds and notifies " +
			"the user — and wakes the agent to report — when its status changes. Returns " +
			"immediately — do NOT sleep-poll: the monitor reports on its own. Use for conditions " +
			"expected to last longer than ~10 seconds (builds, deployments, server readiness, " +
			"file arrival). The command should exit 0 on success and non-zero on failure.",
		parameters: Type.Object({
			task: Type.String({
				description: "Human-readable condition, e.g. \"deploy finished on epyc\".",
			}),
			command: Type.String({
				description: "Shell command (bash) that exits 0 when the condition holds, non-zero otherwise.",
			}),
			intervalSeconds: Type.Optional(
				Type.Number({ description: "Check interval. Minimum 10, default 30." }),
			),
			timeoutSeconds: Type.Optional(
				Type.Number({ description: "Per-check timeout. Default 15, max 60." }),
			),
			notifyOn: Type.Optional(
				Type.Union(
					[
						Type.Literal("change"),
						Type.Literal("success"),
						Type.Literal("fail"),
					],
					{
						description:
							"\"change\": notify on the first result and every status flip; " +
							"\"success\": notify when the check starts passing; \"fail\": notify on failure.",
					},
				),
			),
			report: Type.Optional(
				Type.Boolean({
					description:
						"Wake the agent to report when the condition fires (default true; " +
						"set false for silent background checks).",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			// Capture eagerly: ctx becomes stale after session teardown, but the
			// background timers keep running until session_shutdown clears them.
			const cwd = ctx.cwd;
			notifyFn = (message, type) => {
				if (ctx.hasUI) ctx.ui.notify(message, type);
			};
			if (shutdown) shutdown = false;
			if (monitors.size >= MAX_MONITORS) {
				return {
					content: [
						{
							type: "text",
							text: `at most ${MAX_MONITORS} monitors can run; stop one first (monitor_stop { all: true })`,
						},
					],
					details: {},
				};
			}
			const intervalSeconds = Math.max(MIN_INTERVAL_SECONDS, Math.round(params.intervalSeconds ?? 30));
			const timeoutSeconds = Math.min(MAX_TIMEOUT_SECONDS, Math.max(5, Math.round(params.timeoutSeconds ?? 15)));
			const id = `m${Date.now().toString(36)}`;
			const monitor: Monitor = {
				id,
				task: params.task,
				command: params.command,
				intervalMs: intervalSeconds * 1000,
				timeoutMs: timeoutSeconds * 1000,
				notifyOn: params.notifyOn ?? "change",
				report: params.report ?? true,
				status: "pending",
				lastOutput: "",
				running: false,
				timer: setInterval(() => runCheck(monitor, cwd), intervalSeconds * 1000),
			};
			monitors.set(id, monitor);
			// First check runs soon, not immediately, so the agent can finish its turn.
			setTimeout(() => runCheck(monitor, cwd), 3000);
			appendLogMonitor(cwd, monitor);
			return {
				content: [
					{
						type: "text",
						text:
							`monitor ${id} active: "${monitor.task}", every ${intervalSeconds}s. ` +
							"It runs in the background and notifies on status changes. Do not sleep-poll.",
					},
				],
				details: {
					monitorId: id,
					status: "active",
					intervalSeconds,
					task: monitor.task,
				},
			};
		},
	});

	pi.registerTool({
		name: "monitor_status",
		label: "monitor_status",
		description: "List active background monitors with their latest status and output.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			const entries = Array.from(monitors.values()).map((m) => ({
				monitorId: m.id,
				task: m.task,
				command: m.command,
				intervalSeconds: m.intervalMs / 1000,
				status: m.status,
				lastError: m.lastError ?? null,
				lastRunAt: m.lastRunAt ?? null,
				lastOutput: m.lastOutput.slice(0, 500),
				running: m.running,
			}));
			// eslint-disable-next-line no-console
			console.log(`[monitor] ${entries.length} active`);
			return {
				content: [
					{
						type: "text",
						text: entries.length === 0 ? "No active monitors." : JSON.stringify(entries, null, 2),
					},
				],
				details: { monitors: entries },
			};
		},
	});

	pi.registerTool({
		name: "monitor_stop",
		label: "monitor_stop",
		description: "Stop one background monitor by id, or all of them.",
		parameters: Type.Object({
			monitorId: Type.Optional(Type.String({ description: "Monitor id from monitor." })),
			all: Type.Optional(Type.Boolean({ description: "Stop every active monitor." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const stoppedIds: string[] = [];
			if (params.all) {
				for (const monitor of monitors.values()) {
					clearInterval(monitor.timer);
					monitor.status = "stopped";
					stoppedIds.push(monitor.id);
				}
				monitors.clear();
			} else if (typeof params.monitorId === "string") {
				const monitor = monitors.get(params.monitorId);
				if (monitor) {
					clearInterval(monitor.timer);
					monitor.status = "stopped";
					monitors.delete(monitor.id);
					stoppedIds.push(monitor.id);
				}
			}
			if (stoppedIds.length > 0) {
				appendLog(ctx.cwd, {
					id: "batch",
					task: `stopped: ${stoppedIds.join(", ")}`,
					status: "stopped",
					lastOutput: "",
				});
			}
			return {
				content: [
					{
						type: "text",
						text:
							stoppedIds.length === 0
								? "No monitors stopped."
								: `Stopped monitors: ${stoppedIds.join(", ")}`,
					},
				],
				details: { stopped: stoppedIds },
			};
		},
	});
}
