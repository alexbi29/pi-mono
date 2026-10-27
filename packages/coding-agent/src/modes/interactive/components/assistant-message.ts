import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type Component,
	Container,
	Markdown,
	type MarkdownTheme,
	MouseRegion,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

export const CHARS_PER_TOKEN = 3.5;

/** Stream updates per run before a TPS claim is trustworthy (see buildHiddenThinkingLabel). */
const MIN_TPS_UPDATE_SAMPLES = 4;

export function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Label stats for one thinking run, or a merged group of finished runs. */
interface HiddenThinkingGroup {
	startMs?: number;
	endMs?: number;
	tokens: number;
	exactTokens?: number;
	/** Number of stream updates that touched the run; too few makes TPS meaningless. */
	updates: number;
}

interface ThinkingRunInfo extends HiddenThinkingGroup {
	runIndex: number;
	blocks: string[];
	hasBlocks: boolean;
	autoHidden: boolean;
	finished: boolean;
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	private messageId?: string;
	private timestamp?: string;
	private thinkingVisibilityOverrides = new Map<number, boolean>();
	private thinkingRunStartMs = new Map<number, number>();
	private thinkingRunEndMs = new Map<number, number>();
	private thinkingRunUpdates = new Map<number, number>();
	private activeTickRunIndex: number | undefined;
	private tickLabel: Text | undefined;
	private lastTickText: string | undefined;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		messageId?: string,
		timestamp?: string,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.messageId = messageId;
		this.timestamp = timestamp;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.thinkingVisibilityOverrides.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/**
	 * Hidden "Thinking..." label for one run or a merged group of runs. While the
	 * run is still streaming it shows a ticking elapsed time; once done it uses
	 * the end-of-turn TPS format with the applicable items: TPS, output tokens
	 * (estimated with `~`, or exact provider-reported reasoning tokens when the
	 * finished message reports them), and duration.
	 */
	private buildHiddenThinkingLabel(group: HiddenThinkingGroup): string {
		const { startMs, endMs } = group;
		const outTokenText = (): string =>
			group.exactTokens !== undefined ? group.exactTokens.toLocaleString() : `~${group.tokens.toLocaleString()}`;
		if (startMs === undefined) {
			return `${this.hiddenThinkingLabel} out ${outTokenText()}`;
		}
		if (endMs === undefined) {
			if (this.isStreaming) {
				// Still streaming: show elapsed time; the ticker refreshes this label.
				return `${this.hiddenThinkingLabel} ${((Date.now() - startMs) / 1000).toFixed(1)}s`;
			}
			return `${this.hiddenThinkingLabel} out ${outTokenText()}`;
		}
		// TPS needs a meaningfully sampled span: a run delivered in a handful of
		// buffered chunks (fast local servers) spans only a few event-loop ticks
		// while its token count covers the whole trace, yielding absurd rates.
		if (endMs <= startMs || group.updates < MIN_TPS_UPDATE_SAMPLES) {
			return `${this.hiddenThinkingLabel} out ${outTokenText()}`;
		}
		const seconds = (endMs - startMs) / 1000;
		const tokens = group.exactTokens ?? group.tokens;
		const tokenText = outTokenText();
		const tokensPerSecond = tokens / seconds;
		return `${this.hiddenThinkingLabel} TPS ${tokensPerSecond.toFixed(1)} tok/s. out ${tokenText}, ${seconds.toFixed(1)}s`;
	}

	/** True while a hidden auto-collapsed thinking run is still streaming. */
	hasActiveThinkingRun(): boolean {
		return this.activeTickRunIndex !== undefined && this.tickLabel !== undefined && this.isStreaming;
	}

	/** Refresh the ticking elapsed label. Returns true when the label text changed. */
	refreshThinkingTick(): boolean {
		if (!this.hasActiveThinkingRun()) return false;
		const startMs = this.thinkingRunStartMs.get(this.activeTickRunIndex!);
		if (startMs === undefined) return false;
		const text = `${this.hiddenThinkingLabel} ${((Date.now() - startMs) / 1000).toFixed(1)}s`;
		if (text === this.lastTickText) return false;
		this.lastTickText = text;
		this.tickLabel!.setText(theme.italic(theme.fg("thinkingText", text)));
		return true;
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.lastMessage = message;
		this.isStreaming = isStreaming;
		this.activeTickRunIndex = undefined;
		this.tickLabel = undefined;
		this.lastTickText = undefined;

		// Clear content container
		this.contentContainer.clear();

		// Spacers are added lazily, right before the next visible content block. This puts a blank
		// line before the first visible block and after each visible thinking run that is followed
		// by more visible content, while hidden thinking runs without a label contribute nothing.
		let needsSpacer = true;
		const addVisibleChild = (child: Component) => {
			if (needsSpacer) {
				this.contentContainer.addChild(new Spacer(1));
				needsSpacer = false;
			}
			this.contentContainer.addChild(child);
		};

		// Pre-pass: enumerate thinking runs (adjacent thinking blocks merge into one
		// run). Records streaming timings and groups runs for label merging.
		const runList: ThinkingRunInfo[] = [];
		{
			let runIndex = 0;
			for (let i = 0; i < message.content.length; i++) {
				if (message.content[i].type !== "thinking") continue;
				const blocks: string[] = [];
				let lastIdx = i;
				for (; i < message.content.length; i++) {
					const c = message.content[i];
					if (c.type !== "thinking") break;
					lastIdx = i;
					const thinking = c.thinking.trim();
					if (thinking) blocks.push(thinking);
				}
				i--;
				const idx = runIndex++;
				// Start on the first streaming update that shows the run, end once
				// content follows the run or streaming stops.
				if (isStreaming && !this.thinkingRunStartMs.has(idx)) {
					this.thinkingRunStartMs.set(idx, Date.now());
				}
				if ((lastIdx + 1 < message.content.length || !isStreaming) && !this.thinkingRunEndMs.has(idx)) {
					this.thinkingRunEndMs.set(idx, Date.now());
				}
				if (isStreaming) {
					this.thinkingRunUpdates.set(idx, (this.thinkingRunUpdates.get(idx) ?? 0) + 1);
				}
				runList.push({
					runIndex: idx,
					blocks,
					hasBlocks: blocks.length > 0,
					autoHidden: this.hideThinkingBlock && !this.thinkingVisibilityOverrides.has(idx),
					finished: this.thinkingRunEndMs.has(idx),
					startMs: this.thinkingRunStartMs.get(idx),
					endMs: this.thinkingRunEndMs.get(idx),
					tokens: estimateTextTokens(blocks.join("\n\n")),
					updates: this.thinkingRunUpdates.get(idx) ?? 0,
				});
			}
		}

		// Exact provider-reported reasoning tokens are known only at message end.
		// They describe the whole message, so they are only usable when every run
		// collapses into the single auto-hidden label.
		const exactReasoningTokens =
			!isStreaming &&
			typeof message.usage.reasoning === "number" &&
			message.usage.reasoning > 0 &&
			runList.length > 0 &&
			runList.every((run) => !run.hasBlocks || run.autoHidden)
				? message.usage.reasoning
				: undefined;

		// Merge all finished auto-hidden runs into one label to save vertical space.
		// The first such run renders the merged label; the rest render nothing.
		let mergedRun: (HiddenThinkingGroup & { runIndices: number[] }) | undefined;
		for (const run of runList) {
			if (!run.hasBlocks || !run.autoHidden || !run.finished) continue;
			if (!mergedRun) {
				mergedRun = {
					runIndices: [run.runIndex],
					startMs: run.startMs,
					endMs: run.endMs,
					tokens: run.tokens,
					exactTokens: exactReasoningTokens,
					updates: run.updates,
				};
			} else {
				mergedRun.runIndices.push(run.runIndex);
				mergedRun.tokens += run.tokens;
				mergedRun.updates = Math.min(mergedRun.updates, run.updates);
				if (run.startMs !== undefined && (mergedRun.startMs === undefined || run.startMs < mergedRun.startMs)) {
					mergedRun.startMs = run.startMs;
				}
				if (run.endMs !== undefined && (mergedRun.endMs === undefined || run.endMs > mergedRun.endMs)) {
					mergedRun.endMs = run.endMs;
				}
			}
		}

		// Render content in order
		let thinkRunOrdinal = 0;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				addVisibleChild(
					new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme, undefined, {
						transform: createMarkdownTransform(
							"assistant",
							this.isStreaming,
							this.markdownTransformers,
							this.messageId,
							this.timestamp,
						),
					}),
				);
			} else if (content.type === "thinking") {
				// Advance over the whole adjacent thinking group; run metadata comes
				// from the pre-pass, in the same content order.
				while (i < message.content.length && message.content[i].type === "thinking") i++;
				i--;
				const runInfo = runList[thinkRunOrdinal++];
				if (!runInfo || !runInfo.hasBlocks) {
					continue;
				}

				// Finished auto-hidden runs beyond the first merge into the group label;
				// visible (click-expanded) and still-streaming runs render individually.
				if (runInfo.autoHidden && runInfo.finished && mergedRun && mergedRun.runIndices[0] !== runInfo.runIndex) {
					continue;
				}

				const hidden = this.thinkingVisibilityOverrides.get(runInfo.runIndex) ?? this.hideThinkingBlock;
				// A hidden run with an empty label renders nothing, including no spacing.
				if (hidden && !this.hiddenThinkingLabel.trim()) {
					continue;
				}
				const renderedGroup = runInfo.autoHidden && runInfo.finished && mergedRun ? mergedRun : runInfo;
				const thinkingComponent = hidden
					? (() => {
							// Finished runs always show stats, so a click-collapsed merged
							// run self-heals back into a stats label once re-rendered.
							const labelText =
								runInfo.autoHidden || runInfo.finished
									? this.buildHiddenThinkingLabel(renderedGroup)
									: this.hiddenThinkingLabel;
							const label = new Text(theme.italic(theme.fg("thinkingText", labelText)), this.outputPad, 0);
							if (runInfo.autoHidden && !runInfo.finished) {
								this.activeTickRunIndex = runInfo.runIndex;
								this.tickLabel = label;
							}
							return label;
						})()
					: new Markdown(
							runInfo.blocks.join("\n\n"),
							this.outputPad,
							0,
							this.markdownTheme,
							{
								color: (text: string) => theme.fg("thinkingText", text),
								italic: true,
							},
							{
								transform: createMarkdownTransform(
									"assistant-thinking",
									this.isStreaming,
									this.markdownTransformers,
									this.messageId,
									this.timestamp,
								),
							},
						);
				const labelRuns =
					runInfo.autoHidden && runInfo.finished && mergedRun ? mergedRun.runIndices : [runInfo.runIndex];
				addVisibleChild(
					new MouseRegion(thinkingComponent, (event) => {
						if (event.type !== "click" || event.button !== "left") return undefined;
						for (const idx of labelRuns) this.thinkingVisibilityOverrides.set(idx, !hidden);
						if (this.lastMessage) this.updateContent(this.lastMessage);
						return { handled: true };
					}),
				);
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				needsSpacer = true;
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), this.outputPad, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}
