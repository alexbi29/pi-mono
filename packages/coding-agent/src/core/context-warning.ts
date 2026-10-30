/**
 * Rules and wording for the `[context]` warning pi appends when a session gets large.
 *
 * Context usage is a runtime measurement the model cannot observe, yet it states it anyway and then
 * plans around it, so pi is the only source of the number and says so. These helpers decide when a
 * warning is due and what it says; the session layer appends the result.
 */

import { contextFigureFormat } from "./messages.ts";

/** customType of the appended entry. Also the marker named by the `context_usage` prompt rule. */
export const CONTEXT_WARNING_CUSTOM_TYPE = "context-warning";

/** Usage percentage at or above which the first warning is due. */
const WARNING_START_PERCENT = 90;

/** Percentage points between warnings, so one session gets a few at most. */
const WARNING_STEP_PERCENT = 5;

/** Metadata stored with a warning entry, so later turns can see which band was last warned. */
export interface ContextWarningDetails {
	/** Band this warning fired at, in percentage points. */
	band: number;
	/** Measured usage percentage when the warning was written. */
	percent: number;
	/** Measured context tokens when the warning was written. */
	tokens: number;
	/** Context window the measurement was taken against. */
	contextWindow: number;
}

/**
 * Band at which the first warning is due. Normally 90, but a model that compacts earlier must be warned
 * before it compacts, not after: the band drops to the highest 5-point band at least one step below the
 * compaction point, never below one step.
 */
export function firstContextWarningBand(compactionPointPercent: number | undefined): number {
	// A compaction point of exactly 90 must still warn: compaction fires above it, so the band has to sit
	// below, not on top of it.
	if (compactionPointPercent === undefined || compactionPointPercent > WARNING_START_PERCENT) {
		return WARNING_START_PERCENT;
	}
	const ahead = Math.max(
		WARNING_STEP_PERCENT,
		Math.floor((compactionPointPercent - WARNING_STEP_PERCENT) / WARNING_STEP_PERCENT) * WARNING_STEP_PERCENT,
	);
	return ahead;
}

/**
 * Band to warn at now, or undefined when nothing new is due. A band is reported once per context:
 * `lastWarnedBand` is the band of the newest warning the model can still see, so warnings are never
 * repeated within a band and never revised in place.
 */
export function nextContextWarningBand(
	percent: number,
	lastWarnedBand: number | undefined,
	compactionPointPercent: number | undefined,
): number | undefined {
	const startBand = firstContextWarningBand(compactionPointPercent);
	if (percent < startBand) return undefined;
	const band = Math.min(Math.max(Math.floor(percent / WARNING_STEP_PERCENT) * WARNING_STEP_PERCENT, startBand), 100);
	return band > (lastWarnedBand ?? 0) ? band : undefined;
}

/**
 * Line the model reads. `compactionPointPercent` is the percentage at which pi compacts, omitted when
 * no figure is available; usage figures are always pi's own measurement, never an estimate.
 */
export function formatContextWarning(
	usage: { tokens: number; contextWindow: number; percent: number },
	compactionPointPercent: number | undefined,
): string {
	const measured = `[context] ${contextFigureFormat.format(usage.tokens)} of ${contextFigureFormat.format(
		usage.contextWindow,
	)} tokens used (${Math.round(usage.percent)}%).`;
	// Rounded up: promising pressure earlier than pi will act is the failure this feature exists to stop.
	const compactsAt =
		compactionPointPercent === undefined || compactionPointPercent <= 0
			? ""
			: ` pi compacts automatically at ${Math.ceil(compactionPointPercent)}%.`;
	return `${measured}${compactsAt} Keep working, but don't start large edits.`;
}
