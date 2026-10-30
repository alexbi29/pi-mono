import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { CONTEXT_WARNING_CUSTOM_TYPE } from "../../src/core/context-warning.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

/** Seed prompt used to push a small faux window into the first warning band. */
const SEED_CHARS = 6000;

/**
 * Tokens the faux provider reports for the seed turn, measured against a window large enough to be
 * irrelevant. The real window is then derived from it, so this fixture does not drift when the system
 * prompt changes size.
 */
async function measureSeedTokens(): Promise<number> {
	const harness = await createHarness({ models: [{ id: "faux-1", contextWindow: 1_000_000, maxTokens: 100 }] });
	try {
		harness.setResponses([fauxAssistantMessage("noted")]);
		await harness.session.prompt("x".repeat(SEED_CHARS));
		const tokens = harness.session.getContextUsage()?.tokens;
		if (typeof tokens !== "number") throw new Error("faux provider reported no usage");
		return tokens;
	} finally {
		harness.cleanup();
	}
}

function createWarningHarness(
	contextWindow: number,
	reserveTokens: number,
	options: HarnessOptions = {},
): Promise<Harness> {
	return createHarness({
		...options,
		models: [{ id: "faux-1", contextWindow, maxTokens: 100 }],
		settings: {
			compaction: { enabled: true, reserveTokens, keepRecentTokens: Math.floor(contextWindow / 4) },
		},
	});
}

function warningEntries(harness: Harness) {
	return harness.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "custom_message" && entry.customType === CONTEXT_WARNING_CUSTOM_TYPE);
}

function sawWarning(request: TranscriptContext): boolean {
	return request.messages.some((message) => sawWarningMessage(message));
}

/**
 * The `context_usage` rule as the model received it. The system message carries the prompt in named
 * sections, so the rule is read from the section rather than out of a joined prompt string.
 */
function contextUsageRule(request: TranscriptContext): string {
	const system = request.messages.find((message) => message.role === "system") as
		| { sections?: Record<string, string> }
		| undefined;
	return system?.sections?.context_usage ?? "";
}

function sawWarningMessage(message: TranscriptContext["messages"][number]): boolean {
	const startsWithMarker = (text: string) => text.startsWith("[context]");
	if (message.role !== "user") return false;
	if (typeof message.content === "string") return startsWithMarker(message.content);
	return (
		Array.isArray(message.content) &&
		message.content.some((block) => block.type === "text" && startsWithMarker(block.text))
	);
}

describe("context warning", () => {
	it("warns once when usage crosses the band and the model reads it on the next turn", async () => {
		const measured = await measureSeedTokens();
		// Window puts the seed turn at ~90.4% of context; the reserve keeps the compaction point at
		// 96%, so the warning band is what fires rather than a compaction.
		const contextWindow = Math.ceil(measured / 0.904);
		const harness = await createWarningHarness(contextWindow, Math.ceil(contextWindow / 25));

		try {
			const requests: TranscriptContext[] = [];
			const record = (text: string) => (context: TranscriptContext) => {
				requests.push(context);
				return fauxAssistantMessage(text);
			};
			harness.setResponses([
				record("noted"),
				record("second"),
				record("third"),
				record("fourth"),
				record("fifth"),
				record("sixth"),
			]);

			await harness.session.prompt("x".repeat(SEED_CHARS));
			expect(requests.map(sawWarning)).toEqual([false]);
			expect(warningEntries(harness)).toHaveLength(0);

			await harness.session.prompt("ok");
			await harness.session.prompt("ok");
			await harness.session.prompt("ok");

			// The first follow-up turn carries the warning, and later turns in the same band do not add
			// another one: a number pi already published must never be revised in place.
			expect(requests.map(sawWarning)).toEqual([false, true, true, true]);
			expect(warningEntries(harness)).toHaveLength(1);
			expect(contextUsageRule(requests[1]!)).toContain('lines beginning "[context]"');
		} finally {
			harness.cleanup();
		}
	});

	it("says nothing when auto-compaction cannot act", async () => {
		const measured = await measureSeedTokens();
		const contextWindow = Math.ceil(measured / 0.904);
		const harness = await createWarningHarness(contextWindow, Math.ceil(contextWindow / 25));

		try {
			harness.session.settingsManager.setCompactionEnabled(false);
			harness.setResponses([
				fauxAssistantMessage("noted"),
				fauxAssistantMessage("second"),
				fauxAssistantMessage("third"),
			]);

			await harness.session.prompt("x".repeat(SEED_CHARS));
			await harness.session.prompt("ok");
			await harness.session.prompt("ok");

			expect(warningEntries(harness)).toHaveLength(0);
		} finally {
			harness.cleanup();
		}
	});

	it("promises no warning to a routed selection that cannot get one", async () => {
		const measured = await measureSeedTokens();
		const contextWindow = Math.ceil(measured / 0.904);
		const harness = await createWarningHarness(contextWindow, Math.ceil(contextWindow / 25), {
			extensionFactories: [
				(pi) =>
					pi.registerVirtualModel({
						provider: "router",
						id: "auto",
						name: "Auto",
						thinkingLevels: ["low"],
						contextWindow,
						route: (_request, ctx) => ({
							model: ctx.modelRegistry.find("faux", "faux-1")!,
							thinkingLevel: "low",
						}),
					}),
			],
		});

		try {
			await harness.session.setModel(harness.session.modelRuntime.getModel("router", "auto")!);
			const requests: TranscriptContext[] = [];
			const record = (text: string) => (context: TranscriptContext) => {
				requests.push(context);
				return fauxAssistantMessage(text);
			};
			harness.setResponses([record("noted"), record("second")]);

			// Usage would be in the first warning band for a directly selected model.
			await harness.session.prompt("x".repeat(SEED_CHARS));
			await harness.session.prompt("ok");

			expect(warningEntries(harness)).toHaveLength(0);
			const rule = contextUsageRule(requests.at(-1)!);
			expect(rule).toContain("pi does not report context usage");
			expect(rule).not.toContain('lines beginning "[context]"');
		} finally {
			harness.cleanup();
		}
	});

	it("drops the invalidated warning at compaction and warns again in the new context", async () => {
		const measured = await measureSeedTokens();
		const contextWindow = Math.ceil(measured / 0.904);
		const harness = await createWarningHarness(contextWindow, Math.ceil(contextWindow / 25));

		try {
			const requests: TranscriptContext[] = [];
			const record = (text: string) => (context: TranscriptContext) => {
				requests.push(context);
				return fauxAssistantMessage(text);
			};
			harness.setResponses([record("noted"), record("second"), record("third")]);

			await harness.session.prompt("x".repeat(SEED_CHARS));
			await harness.session.prompt("ok");
			expect(warningEntries(harness)).toHaveLength(1);

			// A compaction that keeps everything: the persisted estimate says the new context is as full as
			// the old one was, so the band still applies while the earlier warning no longer counts.
			const firstEntry = harness.sessionManager.getBranch()[0];
			if (!firstEntry) throw new Error("empty session");
			// appendCompaction() takes details, fromHook, and usage before tokensAfter.
			harness.sessionManager.appendCompaction(
				"summary of everything",
				firstEntry.id,
				measured,
				undefined,
				undefined,
				undefined,
				measured,
			);

			await harness.session.prompt("ok");

			expect(warningEntries(harness)).toHaveLength(2);
			const latest = requests.at(-1);
			if (!latest) throw new Error("no request recorded");
			expect(latest.messages.filter((message) => sawWarningMessage(message))).toHaveLength(1);
		} finally {
			harness.cleanup();
		}
	});

	it("corrects the visible line after a switch to a larger window", async () => {
		const measured = await measureSeedTokens();
		const contextWindow = Math.ceil(measured / 0.904);
		const harness = await createHarness({
			models: [
				{ id: "faux-1", contextWindow, maxTokens: 100 },
				{ id: "faux-large", contextWindow: contextWindow * 10, maxTokens: 100 },
			],
			settings: {
				compaction: {
					enabled: true,
					reserveTokens: Math.ceil(contextWindow / 25),
					keepRecentTokens: Math.floor(contextWindow / 4),
				},
			},
		});

		try {
			const requests: TranscriptContext[] = [];
			const record = (text: string) => (context: TranscriptContext) => {
				requests.push(context);
				return fauxAssistantMessage(text);
			};
			harness.setResponses([record("noted"), record("second"), record("third")]);

			await harness.session.prompt("x".repeat(SEED_CHARS));
			await harness.session.prompt("ok");
			expect(warningEntries(harness)).toHaveLength(1);

			// The same tokens are ~9% of the new window. Without a newer line the model keeps planning
			// around ~90%, and no band would fire until 90% of the larger window.
			await harness.session.setModel(harness.getModel("faux-large")!);
			await harness.session.prompt("ok");

			expect(warningEntries(harness)).toHaveLength(2);
			const latest = requests.at(-1);
			if (!latest) throw new Error("no request recorded");
			const lines = latest.messages.filter((message) => sawWarningMessage(message));
			expect(JSON.stringify(lines.at(-1))).toContain("Earlier [context] lines no longer apply.");
		} finally {
			harness.cleanup();
		}
	});

	it("compacts before the first request of a run when appended messages crossed the point", async () => {
		const measured = await measureSeedTokens();
		// The seed response reports ~70%, well below the 96% compaction point.
		const contextWindow = Math.ceil(measured / 0.7);
		const harness = await createWarningHarness(contextWindow, Math.ceil(contextWindow / 25));

		try {
			harness.setResponses([
				fauxAssistantMessage("noted"),
				fauxAssistantMessage("summary"),
				fauxAssistantMessage("answered"),
			]);
			await harness.session.prompt("x".repeat(SEED_CHARS));

			// Output appended without a response, like `!bash`, takes the context past the point. The last
			// provider usage cannot see it, so only the projected estimate catches it.
			harness.sessionManager.appendCustomMessageEntry("note", "y".repeat(Math.ceil(contextWindow * 1.4)), true);
			await harness.session.prompt("ok");

			expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({ reason: "threshold" });
			// Before the fix, the run sent its first request uncompacted with "(100%). pi compacts automatically at 96%."
			expect(warningEntries(harness)).toHaveLength(0);
		} finally {
			harness.cleanup();
		}
	});
});
