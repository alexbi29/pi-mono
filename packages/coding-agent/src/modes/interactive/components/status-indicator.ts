import { type Component, Loader, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import type { WorkingIndicatorOptions } from "../../../core/extensions/index.ts";
import { formatDuration } from "../../../utils/format.ts";
import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { keyText } from "./keybinding-hints.ts";

export type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

/** Redraw cadence of the working indicator's elapsed timer. */
const ELAPSED_TICK_MS = 1000;

export class StatusIndicator extends Loader {
	readonly kind: StatusIndicatorKind;

	constructor(
		kind: StatusIndicatorKind,
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string,
		indicator?: WorkingIndicatorOptions,
	) {
		super(ui, spinnerColorFn, messageColorFn, message, indicator);
		this.kind = kind;
	}

	renderInBorder(width: number): string {
		const line = super.render(width + 2)[1] ?? "";
		return truncateToWidth(line.startsWith(" ") ? line.slice(1).trimEnd() : line.trimEnd(), width, "");
	}

	renderSpinnerInBorder(width: number): string {
		return truncateToWidth(this.getRenderedIndicator(), width, "");
	}

	dispose(): void {
		this.stop();
	}
}

export class WorkingStatusIndicator extends StatusIndicator {
	private baseMessage: string;
	private startedAtMs: number | undefined;
	private elapsedText = "";
	private elapsedInterval: ReturnType<typeof setInterval> | undefined;

	constructor(
		ui: TUI,
		message: string,
		indicator?: WorkingIndicatorOptions,
		colorFn?: (text: string) => string,
		/** Turn start for the ticking elapsed prefix, shown while the agent runs. Omit to hide it. */
		startedAtMs?: number,
	) {
		super(
			"working",
			ui,
			colorFn ?? ((text) => theme.fg("accent", text)),
			colorFn ?? ((text) => theme.fg("muted", text)),
			message,
			indicator,
		);
		this.baseMessage = message;
		this.startedAtMs = startedAtMs;
		if (startedAtMs !== undefined) {
			this.tickElapsed();
			this.elapsedInterval = setInterval(() => this.tickElapsed(), ELAPSED_TICK_MS);
		}
	}

	/** Keep the caller's message intact and re-apply the elapsed prefix on top of it. */
	override setMessage(message: string): void {
		this.baseMessage = message;
		this.applyElapsed();
	}

	private tickElapsed(): void {
		if (this.startedAtMs === undefined) return;
		const elapsed = formatDuration(Date.now() - this.startedAtMs);
		if (elapsed === this.elapsedText) return;
		this.elapsedText = elapsed;
		this.applyElapsed();
	}

	private applyElapsed(): void {
		// The prefix goes before the message: the embedded border form truncates from the right.
		super.setMessage(this.elapsedText ? `${this.elapsedText} ${this.baseMessage}` : this.baseMessage);
	}

	override dispose(): void {
		if (this.elapsedInterval) {
			clearInterval(this.elapsedInterval);
			this.elapsedInterval = undefined;
		}
		super.dispose();
	}
}

export class RetryStatusIndicator extends StatusIndicator {
	private countdown: CountdownTimer | undefined;

	constructor(ui: TUI, attempt: number, maxAttempts: number, delayMs: number) {
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		super(
			"retry",
			ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.countdown = new CountdownTimer(
			delayMs,
			ui,
			(seconds) => {
				this.setMessage(retryMessage(seconds));
			},
			() => {
				this.countdown = undefined;
			},
		);
	}

	override dispose(): void {
		this.countdown?.dispose();
		this.countdown = undefined;
		super.dispose();
	}
}

export type CompactionStatusReason = "manual" | "threshold" | "overflow";

export class CompactionStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, reason: CompactionStatusReason, colorFn?: (text: string) => string) {
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		super(
			"compaction",
			ui,
			colorFn ?? ((spinner) => theme.fg("accent", spinner)),
			colorFn ?? ((text) => theme.fg("muted", text)),
			label,
		);
	}
}

export class BranchSummaryStatusIndicator extends StatusIndicator {
	constructor(ui: TUI) {
		super(
			"branchSummary",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
	}
}

export class IdleStatus implements Component {
	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		const emptyLine = " ".repeat(width);
		return [emptyLine, emptyLine];
	}
}
