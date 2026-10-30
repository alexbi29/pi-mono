import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { generateBranchSummary, prepareBranchEntries } from "../src/core/compaction/index.ts";
import { CONTEXT_WARNING_CUSTOM_TYPE } from "../src/core/context-warning.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

const model: Model<"anthropic-messages"> = {
	id: "test-model",
	name: "Test Model",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8192,
};

const entries: SessionEntry[] = [
	{
		type: "message",
		id: "branch-user",
		parentId: null,
		timestamp: new Date(1).toISOString(),
		message: { role: "user", content: "Abandoned request", timestamp: 1 },
	},
];

// A warning and a post-compaction note both state sizes of a context this summary replaces.
const warned: SessionEntry[] = [
	...entries,
	{
		type: "custom_message",
		id: "branch-warning",
		parentId: "branch-user",
		timestamp: new Date(2).toISOString(),
		customType: CONTEXT_WARNING_CUSTOM_TYPE,
		content: "[context] 238,412 of 262,144 tokens used (91%). Keep working, but don't start large edits.",
		display: true,
		details: { band: 90, percent: 91, tokens: 238_412, contextWindow: 262_144 },
	},
	{
		type: "compaction",
		id: "branch-compaction",
		parentId: "branch-warning",
		timestamp: new Date(3).toISOString(),
		summary: "Earlier work",
		firstKeptEntryId: "branch-user",
		tokensBefore: 200_000,
		tokensAfter: 35_066,
		contextWindow: 262_144,
	},
];

function response(content: AssistantMessage["content"]): AssistantMessage {
	return {
		...fauxAssistantMessage(""),
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
	};
}

describe("branch summarization", () => {
	it("caps branch summary reasoning to the lowest supported level, never the session level", async () => {
		const seen: Array<SimpleStreamOptions["reasoning"]> = [];
		const streamFn: StreamFn = (_model, _context, options) => {
			seen.push(options?.reasoning);
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({ type: "done", reason: "stop", message: response([{ type: "text", text: "summary" }]) }),
			);
			return stream;
		};
		const reasoningModel = { ...model, reasoning: true };
		const signal = new AbortController().signal;

		await generateBranchSummary(entries, { model: reasoningModel, signal, streamFn, thinkingLevel: "xhigh" });
		await generateBranchSummary(entries, { model: reasoningModel, signal, streamFn, thinkingLevel: "off" });
		await generateBranchSummary(entries, { model, signal, streamFn, thinkingLevel: "high" });

		// "minimal" is the lowest level the model supports; the session's xhigh would leave the
		// summary too little of the shared output budget to finish.
		expect(seen).toEqual(["minimal", undefined, undefined]);
	});

	it("does not override tool choice for branch summaries", async () => {
		let requestOptions: SimpleStreamOptions | undefined;
		const streamFn: StreamFn = (_model, _context, options) => {
			requestOptions = options;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({ type: "done", reason: "stop", message: response([{ type: "text", text: "summary" }]) }),
			);
			return stream;
		};

		await generateBranchSummary(entries, {
			model,
			signal: new AbortController().signal,
			streamFn,
		});

		expect(requestOptions?.toolChoice).toBeUndefined();
	});

	it("uses the configured branch summary output cap", async () => {
		let requestOptions: SimpleStreamOptions | undefined;
		const streamFn: StreamFn = (_model, _context, options) => {
			requestOptions = options;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({ type: "done", reason: "stop", message: response([{ type: "text", text: "summary" }]) }),
			);
			return stream;
		};

		await generateBranchSummary(entries, {
			model,
			signal: new AbortController().signal,
			streamFn,
			summaryMaxTokens: 4096,
		});

		expect(requestOptions?.maxTokens).toBe(4096);
	});

	it("defaults the branch summary output cap to the model output limit", async () => {
		let requestOptions: SimpleStreamOptions | undefined;
		const streamFn: StreamFn = (_model, _context, options) => {
			requestOptions = options;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({ type: "done", reason: "stop", message: response([{ type: "text", text: "summary" }]) }),
			);
			return stream;
		};

		await generateBranchSummary(entries, {
			model,
			signal: new AbortController().signal,
			streamFn,
		});

		expect(requestOptions?.maxTokens).toBe(model.maxTokens);
	});

	it("rejects tool calls from branch summaries", async () => {
		const streamFn: StreamFn = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({
					type: "done",
					reason: "toolUse",
					message: response([
						{ type: "toolCall", id: "tool-call-1", name: "read", arguments: { path: "README.md" } },
					]),
				}),
			);
			return stream;
		};

		const result = await generateBranchSummary(entries, {
			model,
			signal: new AbortController().signal,
			streamFn,
		});

		expect(result.error).toBe("Branch summarization attempted to call a tool");
	});

	it("rejects length-limited branch summaries", async () => {
		const streamFn: StreamFn = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({
					type: "done",
					reason: "length",
					message: { ...response([{ type: "text", text: "partial" }]), stopReason: "length" },
				}),
			);
			return stream;
		};

		const result = await generateBranchSummary(entries, {
			model,
			signal: new AbortController().signal,
			streamFn,
		});

		expect(result.error).toBe(
			`Branch summarization failed: generation hit the token cap (${model.maxTokens.toLocaleString()} tokens) and the summary is incomplete`,
		);
	});

	it("keeps pi's context figures out of the branch summary request", async () => {
		const prompts: string[] = [];
		const streamFn: StreamFn = (_model, context) => {
			const blocks = context.messages[context.messages.length - 1]?.content;
			prompts.push(typeof blocks === "string" ? blocks : JSON.stringify(blocks));
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({ type: "done", reason: "stop", message: response([{ type: "text", text: "summary" }]) }),
			);
			return stream;
		};

		await generateBranchSummary(warned, { model, signal: new AbortController().signal, streamFn });

		expect(prompts).toHaveLength(1);
		const prompt = prompts[0]!;
		const conversation = prompt.slice(prompt.indexOf("<conversation>"), prompt.indexOf("</conversation>"));
		expect(conversation).not.toContain("[context]");
		expect(conversation).not.toContain("Context after compaction");
		expect(conversation).toContain("Earlier work");
	});

	it("hands summarizers, including extension ones, no context figures", () => {
		const { messages } = prepareBranchEntries(warned);

		expect(messages.some((message) => message.role === "custom")).toBe(false);
		expect(messages).toContainEqual(
			expect.objectContaining({ role: "compactionSummary", tokensAfter: undefined, contextWindow: undefined }),
		);
	});
});
