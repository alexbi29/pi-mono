import { describe, expect, it } from "vitest";
import {
	CONTEXT_WARNING_START_PERCENT,
	CONTEXT_WARNING_STEP_PERCENT,
	firstContextWarningBand,
	formatContextWarning,
	nextContextWarningBand,
} from "../src/core/context-warning.ts";

describe("firstContextWarningBand", () => {
	it("starts at the configured percentage when compaction happens later", () => {
		expect(firstContextWarningBand(undefined)).toBe(CONTEXT_WARNING_START_PERCENT);
		expect(firstContextWarningBand(98.4)).toBe(CONTEXT_WARNING_START_PERCENT);
		expect(firstContextWarningBand(CONTEXT_WARNING_START_PERCENT)).toBe(CONTEXT_WARNING_START_PERCENT);
	});

	it("starts earlier when the model compacts before the default point", () => {
		// A 1M-token window with the default reserve compacts at 98.4%, so 90 comes first. A small
		// reserve on a small window can compact at 88%, and a warning after that is useless.
		expect(firstContextWarningBand(88)).toBe(80);
		expect(firstContextWarningBand(60)).toBe(55);
	});

	it("never starts below one step", () => {
		expect(firstContextWarningBand(6)).toBe(CONTEXT_WARNING_STEP_PERCENT);
		expect(firstContextWarningBand(0)).toBe(CONTEXT_WARNING_STEP_PERCENT);
	});
});

describe("nextContextWarningBand", () => {
	it("stays silent below the first band", () => {
		expect(nextContextWarningBand(0, undefined, undefined)).toBeUndefined();
		expect(nextContextWarningBand(89.9, undefined, undefined)).toBeUndefined();
		expect(nextContextWarningBand(16.5, undefined, undefined)).toBeUndefined();
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
});
