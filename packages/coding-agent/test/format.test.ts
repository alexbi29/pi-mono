import { describe, expect, it } from "vitest";
import { formatClockTime } from "../src/utils/format.ts";

describe("formatClockTime", () => {
	const now = new Date(2025, 2, 5, 18, 45, 12);

	it("shows only the time for the current day", () => {
		expect(formatClockTime(new Date(2025, 2, 5, 6, 5).toISOString(), now)).toBe("6:05 AM");
	});

	it("adds the date for an earlier day of the same year", () => {
		expect(formatClockTime(new Date(2025, 2, 4, 18, 45).toISOString(), now)).toBe("Mar 4, 6:45 PM");
	});

	it("drops the time for an earlier year", () => {
		expect(formatClockTime(new Date(2024, 2, 4, 18, 45).toISOString(), now)).toBe("Mar 4, 2024");
	});

	it("returns undefined for an unparseable timestamp", () => {
		expect(formatClockTime("not-a-timestamp", now)).toBeUndefined();
	});
});
