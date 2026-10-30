/**
 * Rules and wording for the `[context]` warning pi appends when a session gets large.
 *
 * Context usage is a runtime measurement the model cannot observe, yet it states it anyway and then
 * plans around it, so pi is the only source of the number and says so. These helpers decide when a
 * warning is due and what it says; the session layer appends the result.
 */

import { contextFigureFormat } from "./messages.ts";
import type { SessionEntry } from "./session-manager.ts";

/** customType of the appended entry. Also the marker named by the `context_usage` prompt rule. */
export const CONTEXT_WARNING_CUSTOM_TYPE = "pi.context-warning";

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

/** The newest `[context]` line the model can still see, as far as the next decision needs it. */
export type VisibleContextWarning = Pick<ContextWarningDetails, "band" | "contextWindow">;

/**
 * A `[context]` line that is due. `warning` reports a band the model has not been told about;
 * `correction` replaces a visible line that now overstates usage, after a model switch or a context edit
 * shrank the context without a compaction.
 */
export type ContextWarning = { kind: "warning"; band: number } | { kind: "correction"; band: number };

/**
 * Band at which the first warning is due: 90, or the highest 5-point band at least one step below the
 * compaction point when that is lower, never below one step. A band closer than one step to the point is
 * skipped by any tool result larger than the gap, so compaction would fire without a warning.
 */
export function firstContextWarningBand(compactionPointPercent: number | undefined): number {
	if (compactionPointPercent === undefined) return WARNING_START_PERCENT;
	const ahead =
		Math.floor((compactionPointPercent - WARNING_STEP_PERCENT) / WARNING_STEP_PERCENT) * WARNING_STEP_PERCENT;
	return Math.max(WARNING_STEP_PERCENT, Math.min(WARNING_START_PERCENT, ahead));
}

/**
 * Line due now, or undefined when nothing new is due. A band is reported once per context, and a line is
 * never revised in place: a visible line that no longer holds is superseded by a newer one.
 */
export function nextContextWarning(
	usage: { percent: number; contextWindow: number },
	visible: VisibleContextWarning | undefined,
	compactionPointPercent: number | undefined,
): ContextWarning | undefined {
	// One step of slack: estimates and provider usage differ slightly, and a correction for that noise
	// would only teach the model that the numbers are unreliable.
	const stale =
		visible !== undefined &&
		(visible.contextWindow !== usage.contextWindow || usage.percent < visible.band - WARNING_STEP_PERCENT);
	const lastBand = stale ? 0 : (visible?.band ?? 0);
	const band = Math.min(Math.floor(usage.percent / WARNING_STEP_PERCENT) * WARNING_STEP_PERCENT, 100);
	const startBand = firstContextWarningBand(compactionPointPercent);
	if (usage.percent >= startBand) {
		const warnedBand = Math.max(band, startBand);
		return warnedBand > lastBand ? { kind: "warning", band: warnedBand } : undefined;
	}
	return stale ? { kind: "correction", band } : undefined;
}

/**
 * Newest `[context]` line still in the model's context. A compaction drops the lines before it, so the
 * walk stops there.
 */
export function latestContextWarning(branch: SessionEntry[]): VisibleContextWarning | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type === "compaction") return undefined;
		if (entry.type !== "custom_message" || entry.customType !== CONTEXT_WARNING_CUSTOM_TYPE) continue;
		// Session files are parsed without validation, so the stored details are checked, not trusted.
		const details = entry.details as Partial<ContextWarningDetails> | undefined;
		if (typeof details?.band !== "number" || typeof details.contextWindow !== "number") return undefined;
		return { band: details.band, contextWindow: details.contextWindow };
	}
	return undefined;
}

/**
 * Line the model reads. `compactionPointPercent` is the percentage at which pi compacts, omitted when
 * no figure is available; usage figures are always pi's own measurement, never an estimate.
 */
export function formatContextWarning(
	warning: ContextWarning,
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
	const advice =
		warning.kind === "warning"
			? "Keep working, but don't start large edits."
			: "Earlier [context] lines no longer apply.";
	return `${measured}${compactsAt} ${advice}`;
}
