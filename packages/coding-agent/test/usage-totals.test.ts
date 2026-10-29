import type { Usage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import type { UsageEntry } from "../src/core/session-manager.ts";
import { combineUsage, formatTurnUsage } from "../src/core/usage-totals.ts";

function usage(total: number, totalFromProvider?: boolean): Usage {
	return {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total,
			...(totalFromProvider === undefined ? {} : { totalFromProvider }),
		},
	};
}

describe("combineUsage", () => {
	it("marks the combined total as provider-reported only when both totals are", () => {
		expect(combineUsage(usage(1, true), usage(2, true)).cost).toMatchObject({ total: 3, totalFromProvider: true });
		expect(combineUsage(usage(1, true), usage(2)).cost.totalFromProvider).toBe(false);
		expect(combineUsage(usage(1), usage(2, true)).cost.totalFromProvider).toBe(false);
		expect(combineUsage(usage(1), usage(2)).cost.totalFromProvider).toBe(false);
	});
});

describe("formatTurnUsage", () => {
	const now = new Date(2025, 2, 5, 18, 45, 12);

	const entry = (elapsedMs?: number, timestamp: Date = now): UsageEntry => ({
		type: "usage",
		kind: "turn",
		provider: "epyc",
		model: "deepseek-v4-flash",
		id: "entry-1",
		parentId: null,
		timestamp: timestamp.toISOString(),
		...(elapsedMs !== undefined ? { elapsedMs } : {}),
		usage: {
			input: 1844,
			output: 434,
			cacheRead: 69888,
			cacheWrite: 0,
			totalTokens: 72166,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	});

	it("leads with duration and finish time when duration is recorded", () => {
		expect(formatTurnUsage(entry(4700), now)).toBe(
			"Took 4.7s • 6:45 PM • 92.3 tok/s • out 434, in 1,844, cache r/w 69,888/0, total 72,166",
		);
	});

	it("formats duration over a minute as minutes and seconds", () => {
		expect(formatTurnUsage(entry(76_000), now)).toBe(
			"Took 1m 16s • 6:45 PM • 5.7 tok/s • out 434, in 1,844, cache r/w 69,888/0, total 72,166",
		);
	});

	it("formats duration over an hour", () => {
		expect(formatTurnUsage(entry(7_384_000), now)).toContain("Took 2h 3m 4s");
	});

	it("omits TPS and duration without elapsed time (older session files)", () => {
		expect(formatTurnUsage(entry(), now)).toBe("6:45 PM • out 434, in 1,844, cache r/w 69,888/0, total 72,166");
	});

	it("adds the date to the finish time of an earlier day", () => {
		expect(formatTurnUsage(entry(1000, new Date(2025, 2, 4, 18, 45)), now)).toContain("Mar 4, 6:45 PM");
	});
});
