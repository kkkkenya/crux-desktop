/**
 * Crux hosted models in the desktop (src/agent/crux-hosted.ts): the relay's model list becomes a
 * "Crux" provider; outside the desktop app there is none.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { CRUX_HOSTED_PROVIDER, cruxHostedProvider, cruxHostedReady, setCruxHostedModelsForTest, toCruxModels } from "../src/agent/crux-hosted.ts";

it("toCruxModels: the relay's list as Crux models, free to the student, with sensible defaults", () => {
	const models = toCruxModels([
		{ id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", context_length: 1048576, max_tokens: 65536, image: true, reasoning: true },
		{ id: "deepseek-flash", name: "DeepSeek Flash (when Gemini is busy)" },
		{ id: "" } as never,
	], "https://crux.test/api/ai/v1");
	assert.equal(models.length, 2);
	assert.deepEqual({ ...models[0] }, {
		id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", api: "openai-completions", provider: CRUX_HOSTED_PROVIDER, baseUrl: "https://crux.test/api/ai/v1",
		reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, type: "chat",
	});
	assert.equal(models[1]!.contextWindow, 131072);
	assert.deepEqual(models[1]!.input, ["text"]);
	assert.equal(models[1]!.reasoning, false);
});

it("outside the desktop app there is no Crux provider, even with models known", () => {
	setCruxHostedModelsForTest([{ id: "gemini-3.8-flash" }]);
	assert.equal(cruxHostedReady(), false);
	assert.equal(cruxHostedProvider(), null);
});
