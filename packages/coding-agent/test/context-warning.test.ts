import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS, shouldCompact } from "../src/core/compaction/index.ts";
import {
	CONTEXT_WARNING_CUSTOM_TYPE,
	firstContextWarningBand,
	formatContextWarning,
	latestContextWarning,
	nextContextWarning,
} from "../src/core/context-warning.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

const WINDOW = 262_144;

/** Usage at `percent` of the default test window. */
function at(percent: number, contextWindow = WINDOW) {
	return { percent, contextWindow };
}

describe("firstContextWarningBand", () => {
	it("starts at 90 percent when compaction happens at least one step later", () => {
		expect(firstContextWarningBand(undefined)).toBe(90);
		expect(firstContextWarningBand(98.4)).toBe(90);
		expect(firstContextWarningBand(95)).toBe(90);
	});

	it("starts one step ahead of a compaction point that is less than a step past 90", () => {
		// The default reserve compacts a 200k window at 91.8 and a 262k window at 93.75. A 90 band there
		// is a 3.6k or 9.8k token gap, which one large tool result skips straight past.
		expect(firstContextWarningBand(91.8)).toBe(85);
		expect(firstContextWarningBand(93.75)).toBe(85);
	});

	it("starts earlier when pi compacts below 90 percent", () => {
		// The compaction point falls below 90 only when reserveTokens is more than 10 percent of the
		// window: a 1M window reserving 400k compacts at 60, and a warning after that is useless.
		expect(firstContextWarningBand(90)).toBe(85);
		expect(firstContextWarningBand(88)).toBe(80);
		expect(firstContextWarningBand(60)).toBe(55);
	});

	it("never starts below one step", () => {
		expect(firstContextWarningBand(6)).toBe(5);
		expect(firstContextWarningBand(0)).toBe(5);
	});
});

describe("nextContextWarning", () => {
	it("stays silent below the first band", () => {
		expect(nextContextWarning(at(0), undefined, undefined)).toBeUndefined();
		expect(nextContextWarning(at(89.9), undefined, undefined)).toBeUndefined();
		expect(nextContextWarning(at(16.5), undefined, undefined)).toBeUndefined();
	});

	it("warns twice between the first band and the compaction point of a default window", () => {
		// A default 262144-token window compacts at 93.75: the 85 band gives room to act, 90 follows.
		expect(nextContextWarning(at(86), undefined, 93.75)).toEqual({ kind: "warning", band: 85 });
		expect(nextContextWarning(at(90.2), { band: 85, contextWindow: WINDOW }, 93.75)).toEqual({
			kind: "warning",
			band: 90,
		});
	});

	it("reports a band once and then waits for the next one", () => {
		const warned = { band: 90, contextWindow: WINDOW };
		expect(nextContextWarning(at(90.2), undefined, undefined)).toEqual({ kind: "warning", band: 90 });
		expect(nextContextWarning(at(92), warned, undefined)).toBeUndefined();
		expect(nextContextWarning(at(94.9), warned, undefined)).toBeUndefined();
		expect(nextContextWarning(at(95.1), warned, undefined)).toEqual({ kind: "warning", band: 95 });
	});

	it("caps at 100 so repeated turns do not raise the band past the window", () => {
		expect(nextContextWarning(at(104), { band: 95, contextWindow: WINDOW }, undefined)).toEqual({
			kind: "warning",
			band: 100,
		});
		expect(nextContextWarning(at(140), { band: 100, contextWindow: WINDOW }, undefined)).toBeUndefined();
	});

	it("follows the compaction point of a small window", () => {
		expect(nextContextWarning(at(83), undefined, 88)).toEqual({ kind: "warning", band: 80 });
		expect(nextContextWarning(at(83), { band: 80, contextWindow: WINDOW }, 88)).toBeUndefined();
		expect(nextContextWarning(at(70), undefined, 88)).toBeUndefined();
	});

	it("corrects a visible line after a switch to a larger window", () => {
		// 180,000 tokens was 90% of a 200k window and is 18% of a 1M window. Without a newer line the model
		// keeps planning around 90%, and no band fires until 90% of the new window.
		expect(nextContextWarning(at(18, 1_000_000), { band: 90, contextWindow: 200_000 }, 98.4)).toEqual({
			kind: "correction",
			band: 15,
		});
	});

	it("warns afresh after a switch to a smaller window", () => {
		expect(nextContextWarning(at(91, 200_000), { band: 95, contextWindow: WINDOW }, 98)).toEqual({
			kind: "warning",
			band: 90,
		});
	});

	it("corrects a visible line when usage fell by more than a step without a compaction", () => {
		const warned = { band: 90, contextWindow: WINDOW };
		expect(nextContextWarning(at(40), warned, 98.4)).toEqual({ kind: "correction", band: 40 });
		// Estimate noise within a step is not a correction.
		expect(nextContextWarning(at(85.5), warned, 98.4)).toBeUndefined();
	});

	it("warns again once usage grows back from a correction", () => {
		const corrected = { band: 40, contextWindow: WINDOW };
		expect(nextContextWarning(at(60), corrected, 98.4)).toBeUndefined();
		expect(nextContextWarning(at(90.5), corrected, 98.4)).toEqual({ kind: "warning", band: 90 });
	});
});

describe("latestContextWarning", () => {
	const base = { parentId: null, timestamp: "2026-10-30T00:00:00.000Z" };
	const warning = (id: string, details: unknown): SessionEntry => ({
		...base,
		id,
		type: "custom_message",
		customType: CONTEXT_WARNING_CUSTOM_TYPE,
		content: "[context] ...",
		display: true,
		details,
	});
	const compaction: SessionEntry = {
		...base,
		id: "c",
		type: "compaction",
		summary: "summary",
		firstKeptEntryId: "c",
		tokensBefore: 1,
	};

	it("returns the newest visible line", () => {
		const branch = [
			warning("a", { band: 90, contextWindow: WINDOW }),
			warning("b", { band: 95, contextWindow: WINDOW }),
		];
		expect(latestContextWarning(branch)).toEqual({ band: 95, contextWindow: WINDOW });
	});

	it("ignores lines a compaction dropped", () => {
		expect(latestContextWarning([warning("a", { band: 90, contextWindow: WINDOW }), compaction])).toBeUndefined();
	});

	it("treats a line with malformed details as absent", () => {
		expect(latestContextWarning([warning("a", { band: "90" })])).toBeUndefined();
	});
});

describe("formatContextWarning", () => {
	const usage = { tokens: 238_412, contextWindow: WINDOW, percent: 90.95 };
	const warning = { kind: "warning", band: 90 } as const;

	it("states pi's measurement, the compaction point, and the requested behaviour", () => {
		expect(formatContextWarning(warning, usage, 93.75)).toBe(
			"[context] 238,412 of 262,144 tokens used (91%). pi compacts automatically at 94%. Keep working, but don't start large edits.",
		);
	});

	it("says a correction supersedes earlier lines", () => {
		expect(
			formatContextWarning(
				{ kind: "correction", band: 15 },
				{ tokens: 180_000, contextWindow: 1_000_000, percent: 18 },
				98.4,
			),
		).toBe(
			"[context] 180,000 of 1,000,000 tokens used (18%). pi compacts automatically at 99%. Earlier [context] lines no longer apply.",
		);
	});

	it("omits the compaction sentence when there is no compaction point", () => {
		expect(formatContextWarning(warning, usage, undefined)).toBe(
			"[context] 238,412 of 262,144 tokens used (91%). Keep working, but don't start large edits.",
		);
		expect(formatContextWarning(warning, usage, 0)).toBe(
			"[context] 238,412 of 262,144 tokens used (91%). Keep working, but don't start large edits.",
		);
	});

	it("prints a compaction point that is never earlier than shouldCompact acts", () => {
		const { reserveTokens } = DEFAULT_COMPACTION_SETTINGS;
		const atThreshold = WINDOW - reserveTokens;
		const compactionPoint = ((atThreshold + 1) / WINDOW) * 100;

		// Rounding is upward, so the printed point cannot promise pressure before pi really acts.
		expect(shouldCompact(atThreshold, WINDOW, DEFAULT_COMPACTION_SETTINGS)).toBe(false);
		expect(shouldCompact(atThreshold + 1, WINDOW, DEFAULT_COMPACTION_SETTINGS)).toBe(true);
		expect(formatContextWarning(warning, { ...usage, percent: 90.5 }, compactionPoint)).toContain(
			"pi compacts automatically at 94%.",
		);
	});
});
