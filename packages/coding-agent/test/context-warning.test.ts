import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS, shouldCompact } from "../src/core/compaction/index.ts";
import { firstContextWarningBand, formatContextWarning, nextContextWarningBand } from "../src/core/context-warning.ts";

describe("firstContextWarningBand", () => {
	it("starts at 90 percent when compaction happens later", () => {
		expect(firstContextWarningBand(undefined)).toBe(90);
		expect(firstContextWarningBand(98.4)).toBe(90);
		expect(firstContextWarningBand(93.75)).toBe(90);
	});

	it("starts earlier when pi compacts below 90 percent", () => {
		// The compaction point falls below 90 only when reserveTokens is more than 10 percent of the
		// window: a 1M window reserving 400k compacts at 60, and a warning after that is useless.
		expect(firstContextWarningBand(88)).toBe(80);
		expect(firstContextWarningBand(60)).toBe(55);
	});

	it("starts below a compaction point of exactly 90 percent", () => {
		// Compaction fires above the point, so a band sitting on it could never be reached. A window
		// reserving exactly a tenth of itself lands here: 200000 tokens, 20000 reserve.
		expect(firstContextWarningBand(90)).toBe(85);
	});

	it("never starts below one step", () => {
		expect(firstContextWarningBand(6)).toBe(5);
		expect(firstContextWarningBand(0)).toBe(5);
	});
});

describe("nextContextWarningBand", () => {
	it("stays silent below the first band", () => {
		expect(nextContextWarningBand(0, undefined, undefined)).toBeUndefined();
		expect(nextContextWarningBand(89.9, undefined, undefined)).toBeUndefined();
		expect(nextContextWarningBand(16.5, undefined, undefined)).toBeUndefined();
	});

	it("warns once between the first band and the compaction point", () => {
		// A default 262144-token window with the default reserve compacts at 93.75, so the 90 band is
		// the only one that can fire before pi frees context.
		expect(nextContextWarningBand(90.2, undefined, 93.75)).toBe(90);
	});

	it("reports a band once and then waits for the next one", () => {
		expect(nextContextWarningBand(90.2, undefined, undefined)).toBe(90);
		expect(nextContextWarningBand(92, 90, undefined)).toBeUndefined();
		expect(nextContextWarningBand(94.9, 90, undefined)).toBeUndefined();
		expect(nextContextWarningBand(95.1, 90, undefined)).toBe(95);
	});

	it("caps at 100 so repeated turns do not raise the band past the window", () => {
		expect(nextContextWarningBand(104, 95, undefined)).toBe(100);
		expect(nextContextWarningBand(140, 100, undefined)).toBeUndefined();
	});

	it("follows the compaction point of a small window", () => {
		expect(nextContextWarningBand(83, undefined, 88)).toBe(80);
		expect(nextContextWarningBand(83, 80, 88)).toBeUndefined();
		expect(nextContextWarningBand(70, undefined, 88)).toBeUndefined();
	});
});

describe("formatContextWarning", () => {
	const usage = { tokens: 238_412, contextWindow: 262_144, percent: 90.95 };

	it("states pi's measurement, the compaction point, and the requested behaviour", () => {
		expect(formatContextWarning(usage, 93.75)).toBe(
			"[context] 238,412 of 262,144 tokens used (91%). pi compacts automatically at 94%. Keep working, but don't start large edits.",
		);
	});

	it("omits the compaction sentence when there is no compaction point", () => {
		expect(formatContextWarning(usage, undefined)).toBe(
			"[context] 238,412 of 262,144 tokens used (91%). Keep working, but don't start large edits.",
		);
		expect(formatContextWarning(usage, 0)).toBe(
			"[context] 238,412 of 262,144 tokens used (91%). Keep working, but don't start large edits.",
		);
	});

	it("prints a compaction point that is never earlier than shouldCompact acts", () => {
		const { reserveTokens } = DEFAULT_COMPACTION_SETTINGS;
		const contextWindow = 262_144;
		const atThreshold = contextWindow - reserveTokens;
		const compactionPoint = ((atThreshold + 1) / contextWindow) * 100;

		// Rounding is upward, so the printed point cannot promise pressure before pi really acts.
		expect(shouldCompact(atThreshold, contextWindow, DEFAULT_COMPACTION_SETTINGS)).toBe(false);
		expect(shouldCompact(atThreshold + 1, contextWindow, DEFAULT_COMPACTION_SETTINGS)).toBe(true);
		expect(formatContextWarning({ ...usage, percent: 90.5 }, compactionPoint)).toContain(
			"pi compacts automatically at 94%.",
		);
	});
});
