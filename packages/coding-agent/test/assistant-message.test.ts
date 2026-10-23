import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function createAssistantMessage(
	content: AssistantMessage["content"],
	overrides: Partial<Pick<AssistantMessage, "stopReason">> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: overrides.stopReason ?? "stop",
		timestamp: Date.now(),
	};
}

describe("AssistantMessageComponent", () => {
	test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		const lines = component.render(40);

		expect(lines).not.toHaveLength(0);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
			]),
		);
		const rendered = component.render(60).join("\n");

		expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
	});

	test("renders length stops with neutral truncation wording", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: "private reasoning" }], { stopReason: "length" }),
			true,
		);
		const rendered = component.render(80).join("\n");

		expect(rendered).toContain("Thinking...");
		expect(rendered).toContain("Response was truncated before completion.");
	});

	test("replaces the hidden thinking label with stats once thinking finishes", () => {
		initTheme("dark");
		vi.useFakeTimers();
		try {
			const component = new AssistantMessageComponent(undefined, true, undefined, "Thinking...", 1);
			const thinking = [{ type: "thinking" as const, thinking: "private reasoning" }];

			vi.setSystemTime(1000);
			component.updateContent(createAssistantMessage(thinking), true);
			expect(stripAnsi(component.render(80).join("\n"))).toContain("Thinking...");

			// Three more stream updates so the run span is actually sampled.
			vi.setSystemTime(1500);
			component.updateContent(createAssistantMessage(thinking), true);
			vi.setSystemTime(2000);
			component.updateContent(createAssistantMessage(thinking), true);
			vi.setSystemTime(2250);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "private reasoning" },
					{ type: "text", text: "answer" },
				]),
				true,
			);

			const rendered = stripAnsi(component.render(80).join("\n"));
			expect(rendered).toContain("answer");
			expect(rendered).toMatch(/Thinking\.\.\. TPS 4\.0 tok\/s\. out ~5, 1\.3s/);

			// Streamed updates must not drift the frozen duration.
			vi.setSystemTime(5000);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "private reasoning" },
					{ type: "text", text: "answer" },
				]),
				true,
			);
			expect(stripAnsi(component.render(80).join("\n"))).toMatch(/Thinking\.\.\. TPS 4\.0 tok\/s\. out ~5, 1\.3s/);
		} finally {
			vi.useRealTimers();
		}
	});

	test("shows tokens-only stats for hidden thinking when streaming timing is unavailable", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "first thought" },
				{ type: "text", text: "answer" },
			]),
			true,
		);
		const rendered = stripAnsi(component.render(80).join("\n"));
		expect(rendered).toMatch(/Thinking\.\.\. out ~\d+/);
		expect(rendered).not.toContain("tok/s");
	});

	test("does not claim TPS for short traces delivered in few stream updates", () => {
		initTheme("dark");
		vi.useFakeTimers();
		try {
			const component = new AssistantMessageComponent(undefined, true, undefined, "Thinking...", 1);
			vi.setSystemTime(1000);
			component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "a very short trace" }]), true);
			// Only three updates total: the span is one or two event-loop ticks and
			// would otherwise report an absurd rate.
			vi.setSystemTime(1010);
			component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "a very short trace" }]), true);
			vi.setSystemTime(1020);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "a very short trace" },
					{ type: "text", text: "answer" },
				]),
				true,
			);

			const rendered = stripAnsi(component.render(80).join("\n"));
			expect(rendered).toMatch(/Thinking\.\.\. out ~\d+/);
			expect(rendered).not.toContain("tok/s");
		} finally {
			vi.useRealTimers();
		}
	});

	test("ticks the elapsed time on the active hidden thinking label", () => {
		initTheme("dark");
		vi.useFakeTimers();
		try {
			const component = new AssistantMessageComponent(undefined, true, undefined, "Thinking...", 1);

			vi.setSystemTime(1000);
			component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "private reasoning" }]), true);
			expect(stripAnsi(component.render(80).join("\n"))).toContain("Thinking... 0.0s");

			vi.setSystemTime(2250);
			expect(component.hasActiveThinkingRun()).toBe(true);
			expect(component.refreshThinkingTick()).toBe(true);
			expect(stripAnsi(component.render(80).join("\n"))).toContain("Thinking... 1.3s");
			// Unchanged text is not reported as a refresh.
			expect(component.refreshThinkingTick()).toBe(false);

			// Two more stream updates so the final span is actually sampled.
			vi.setSystemTime(3000);
			component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "private reasoning" }]), true);
			vi.setSystemTime(4000);
			component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "private reasoning" }]), true);

			vi.setSystemTime(5000);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "private reasoning" },
					{ type: "text", text: "answer" },
				]),
				true,
			);
			expect(component.hasActiveThinkingRun()).toBe(false);
			expect(stripAnsi(component.render(80).join("\n"))).toMatch(
				/Thinking\.\.\. TPS \d+\.\d+ tok\/s\. out ~5, 4\.0s/,
			);
		} finally {
			vi.useRealTimers();
		}
	});

	test("uses exact provider reasoning tokens once the message finishes", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "thinking", thinking: "private reasoning" },
			{ type: "text", text: "answer" },
		]);
		message.usage.reasoning = 42;
		const component = new AssistantMessageComponent(message, true);

		const rendered = stripAnsi(component.render(80).join("\n"));
		expect(rendered).toContain("out 42");
		expect(rendered).not.toContain("~");
	});

	test("coalesces finished thinking runs into one stats label", () => {
		initTheme("dark");
		vi.useFakeTimers();
		try {
			const component = new AssistantMessageComponent(undefined, true, undefined, "Thinking...", 1);
			vi.setSystemTime(1000);
			component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "first" }]), true);
			vi.setSystemTime(1010);
			component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "first" }]), true);
			vi.setSystemTime(1020);
			component.updateContent(createAssistantMessage([{ type: "thinking", thinking: "first" }]), true);
			vi.setSystemTime(1030);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "first" },
					{ type: "text", text: "middle" },
				]),
				true,
			);
			vi.setSystemTime(1040);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "first" },
					{ type: "text", text: "middle" },
					{ type: "thinking", thinking: "second" },
				]),
				true,
			);
			vi.setSystemTime(1050);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "first" },
					{ type: "text", text: "middle" },
					{ type: "thinking", thinking: "second" },
				]),
				true,
			);
			vi.setSystemTime(1060);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "first" },
					{ type: "text", text: "middle" },
					{ type: "thinking", thinking: "second" },
				]),
				true,
			);
			vi.setSystemTime(1100);
			component.updateContent(
				createAssistantMessage([
					{ type: "thinking", thinking: "first" },
					{ type: "text", text: "middle" },
					{ type: "thinking", thinking: "second" },
					{ type: "text", text: "answer" },
				]),
				true,
			);

			const rendered = stripAnsi(component.render(80).join("\n"));
			// One merged stats label for both finished runs.
			expect(rendered.match(/Thinking\.\.\./g)).toHaveLength(1);
			expect(rendered).toContain("middle");
			expect(rendered).toContain("answer");
			expect(rendered).toMatch(/Thinking\.\.\. TPS 40\.0 tok\/s\. out ~4, 0\.1s/);

			// Clicking the merged label expands every merged run.
			const width = 80;
			const lines = component.render(width);
			const labelRow = lines.findIndex((line) => stripAnsi(line).includes("Thinking..."));
			expect(labelRow).toBeGreaterThanOrEqual(0);
			const event: TuiMouseEvent = {
				type: "click",
				button: "left",
				x: 1,
				y: labelRow,
				screenX: 1,
				screenY: labelRow,
				width,
				height: lines.length,
				shift: false,
				alt: false,
				ctrl: false,
				clickCount: 1,
			};
			expect(component.handleMouse(event)?.handled).toBe(true);
			const expanded = stripAnsi(component.render(width).join("\n"));
			expect(expanded).toContain("first");
			expect(expanded).toContain("second");
			expect(expanded).toContain("middle");
		} finally {
			vi.useRealTimers();
		}
	});

	test("coalesces adjacent thinking blocks into one hidden thinking label", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "first thought" },
				{ type: "thinking", thinking: "" },
				{ type: "thinking", thinking: "second thought" },
				{ type: "text", text: "answer" },
			]),
			true,
		);
		const rendered = stripAnsi(component.render(80).join("\n"));

		expect(rendered.match(/Thinking\.\.\./g)).toHaveLength(1);
		expect(rendered).toContain("answer");
	});

	test("collapses individual thinking runs when clicked", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "first reasoning" },
				{ type: "text", text: "answer" },
				{ type: "thinking", thinking: "second reasoning" },
			]),
		);
		const width = 80;
		const lines = component.render(width);
		const firstThinkingRow = lines.findIndex((line) => stripAnsi(line).includes("first reasoning"));
		expect(firstThinkingRow).toBeGreaterThanOrEqual(0);
		const event: TuiMouseEvent = {
			type: "click",
			button: "left",
			x: 1,
			y: firstThinkingRow,
			screenX: 1,
			screenY: firstThinkingRow,
			width,
			height: lines.length,
			shift: false,
			alt: false,
			ctrl: false,
			clickCount: 1,
		};
		expect(component.handleMouse(event)?.handled).toBe(true);

		const collapsed = stripAnsi(component.render(width).join("\n"));
		expect(collapsed).not.toContain("first reasoning");
		expect(collapsed).toContain("Thinking...");
		expect(collapsed).toContain("second reasoning");
	});

	test("uses configured output padding for text and thinking", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "hello" },
				{ type: "thinking", thinking: "reasoning" },
			]),
			false,
			undefined,
			"Thinking...",
			1,
		);
		const lines = component.render(80).map((line) => stripAnsi(line));

		expect(lines.some((line) => line.includes(" hello"))).toBe(true);
		expect(lines.some((line) => line.includes(" reasoning"))).toBe(true);

		component.setOutputPad(0);
		const updatedLines = component.render(80).map((line) => stripAnsi(line));
		expect(updatedLines.some((line) => line.startsWith("hello"))).toBe(true);
		expect(updatedLines.some((line) => line.startsWith("reasoning"))).toBe(true);
	});

	test("chains Markdown transformers in registration order", () => {
		initTheme("dark");
		const calls: string[] = [];
		const message = createAssistantMessage([{ type: "text", text: "The result is $x^2$." }]);
		const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, [
			(markdown, context) => {
				calls.push("formula");
				expect(context).toEqual({ messageType: "assistant", isStreaming: false, availableWidth: 78 });
				return markdown.replace("$x^2$", "x²");
			},
			(markdown) => {
				calls.push("suffix");
				return `${markdown} Done.`;
			},
		]);

		expect(stripAnsi(component.render(80).join("\n"))).toContain("The result is x². Done.");
		expect(calls).toEqual(["formula", "suffix"]);
	});

	test("identifies partial assistant Markdown as streaming", () => {
		initTheme("dark");
		const streamingStates: boolean[] = [];
		const message = createAssistantMessage([{ type: "text", text: "partial" }]);
		const component = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 1, [
			(markdown, context) => {
				streamingStates.push(context.isStreaming);
				return context.isStreaming ? markdown : `${markdown} transformed`;
			},
		]);

		component.updateContent(message, true);
		expect(stripAnsi(component.render(80).join("\n"))).not.toContain("transformed");

		component.updateContent(message, false);
		expect(stripAnsi(component.render(80).join("\n"))).toContain("partial transformed");
		expect(streamingStates).toEqual([true, false]);
	});

	test("reapplies Markdown transformers when available width changes", () => {
		initTheme("dark");
		const availableWidths: number[] = [];
		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "answer" }]),
			false,
			undefined,
			"Thinking...",
			1,
			[
				(markdown, context) => {
					availableWidths.push(context.availableWidth);
					return `${markdown} (${context.availableWidth})`;
				},
			],
		);

		expect(stripAnsi(component.render(80).join("\n"))).toContain("answer (78)");
		component.render(80);
		expect(stripAnsi(component.render(60).join("\n"))).toContain("answer (58)");
		expect(availableWidths).toEqual([78, 58]);
	});

	test("continues the Markdown transformer chain when a transformer throws", () => {
		initTheme("dark");
		const calls: string[] = [];
		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "still visible" }]),
			false,
			undefined,
			"Thinking...",
			1,
			[
				(markdown) => {
					calls.push("first");
					return markdown.replace("still", "remains");
				},
				() => {
					calls.push("throw");
					throw new Error("broken transformer");
				},
				(markdown) => {
					calls.push("last");
					return `${markdown} after error`;
				},
			],
		);

		expect(stripAnsi(component.render(80).join("\n"))).toContain("remains visible after error");
		expect(calls).toEqual(["first", "throw", "last"]);
	});

	test("transforms text and thinking Markdown without mutating the original message", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "text", text: "answer" },
			{ type: "thinking", thinking: "reasoning" },
		]);
		const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, [
			(markdown, { messageType }) => {
				return `${messageType}:${markdown}`;
			},
		]);

		const rendered = stripAnsi(component.render(80).join("\n"));
		expect(rendered).toContain("assistant:answer");
		expect(rendered).toContain("assistant-thinking:reasoning");
		expect(message.content).toEqual([
			{ type: "text", text: "answer" },
			{ type: "thinking", thinking: "reasoning" },
		]);
	});

	test("uses configured output padding for user messages", () => {
		initTheme("dark");

		const paddedComponent = new UserMessageComponent("hello", undefined, 1);
		const paddedLines = paddedComponent.render(40).map((line) => stripAnsi(line));
		expect(paddedLines.some((line) => line.startsWith(" hello"))).toBe(true);

		const unpaddedComponent = new UserMessageComponent("hello", undefined, 0);
		const unpaddedLines = unpaddedComponent.render(40).map((line) => stripAnsi(line));
		expect(unpaddedLines.some((line) => line.startsWith("hello"))).toBe(true);
	});
});
