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
	const entry = (elapsedMs?: number): UsageEntry => ({
		type: "usage",
		kind: "turn",
		provider: "epyc",
		model: "deepseek-v4-flash",
		id: "entry-1",
		parentId: null,
		timestamp: new Date().toISOString(),
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

	it("formats the classic TPS line when duration is recorded", () => {
		expect(formatTurnUsage(entry(4700))).toBe(
			"TPS 92.3 tok/s. out 434, in 1,844, cache r/w 69,888/0, total 72,166, 4.7s",
		);
	});

	it("omits TPS and duration without elapsed time (older session files)", () => {
		expect(formatTurnUsage(entry())).toBe("out 434, in 1,844, cache r/w 69,888/0, total 72,166");
	});
});
