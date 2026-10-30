import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { CONTEXT_WARNING_CUSTOM_TYPE } from "../../src/core/context-warning.ts";
import { createHarness, type Harness } from "./harness.ts";

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

function createWarningHarness(contextWindow: number, reserveTokens: number): Promise<Harness> {
	return createHarness({
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
});
