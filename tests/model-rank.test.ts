import assert from "node:assert/strict";
import { it } from "node:test";
import { modelTier, modelVersion, rankModels } from "../components/model-rank.ts";

it("modelVersion reads the version and ignores dates", () => {
	assert.equal(modelVersion("claude-sonnet-4-5-20250929"), 4.5);
	assert.equal(modelVersion("claude-3-5-sonnet-20241022"), 3.5);
	assert.equal(modelVersion("claude-opus-4-7"), 4.7);
	assert.equal(modelVersion("gpt-4.1-mini"), 4.1);
	assert.equal(modelVersion("gpt-4o"), 4);
	assert.equal(modelVersion("o3"), 3);
	assert.equal(modelVersion("gemini-2.5-pro"), 2.5);
	assert.equal(modelVersion("glm-5.3-flash"), 5.3);
	assert.equal(modelVersion("deepseek-chat"), null);
	assert.equal(modelVersion("models/gemini-3-pro-preview"), 3);
});

it("modelTier", () => {
	assert.equal(modelTier("claude-opus-4-7"), 3);
	assert.equal(modelTier("gemini-2.5-pro"), 3);
	assert.equal(modelTier("deepseek-reasoner"), 3);
	assert.equal(modelTier("claude-sonnet-4-5"), 2);
	assert.equal(modelTier("claude-haiku-4-5"), 1);
	assert.equal(modelTier("gemini-2.5-flash"), 1);
	assert.equal(modelTier("gemini-2.5-flash-lite"), 0);
	assert.equal(modelTier("gpt-5-nano"), 0);
});

it("the best current models first, older generations after", () => {
	const m = (provider: string, id: string) => ({ provider, id });
	const list = [
		m("anthropic", "claude-3-5-haiku-20241022"),
		m("anthropic", "claude-sonnet-4-5-20250929"),
		m("google", "gemini-2.5-flash"),
		m("anthropic", "claude-opus-4-7"),
		m("google", "gemini-3-pro-preview"),
		m("deepseek", "deepseek-chat"),
		m("deepseek", "deepseek-reasoner"),
		m("anthropic", "claude-3-7-sonnet-20250219"),
		m("google", "gemini-2.5-pro"),
		m("anthropic", "claude-opus-4-7-haiku-test".replace("-haiku-test", "")), // duplicate id kept stable
	].slice(0, 9);
	const ids = rankModels(list).map((x) => x.id);
	// current generation, top tier first
	assert.deepEqual(ids.slice(0, 3).sort(), ["claude-opus-4-7", "deepseek-reasoner", "gemini-3-pro-preview"]);
	// deepseek-chat (current, standard) before any older generation
	assert.ok(ids.indexOf("deepseek-chat") < ids.indexOf("gemini-2.5-pro"));
	// older generations last, newest of them first
	assert.ok(ids.indexOf("claude-sonnet-4-5-20250929") < ids.indexOf("claude-3-7-sonnet-20250219"));
	assert.ok(ids.indexOf("claude-3-7-sonnet-20250219") < ids.indexOf("claude-3-5-haiku-20241022"));
	assert.deepEqual(ids.slice(-2).sort(), ["claude-3-5-haiku-20241022", "gemini-2.5-flash"], "older small models last");
});

it("Claude Code aliases (no version) are current, opus first", () => {
	const ids = rankModels([{ provider: "claude-code", id: "haiku" }, { provider: "claude-code", id: "sonnet" }, { provider: "claude-code", id: "opus" }]).map((x) => x.id);
	assert.deepEqual(ids, ["opus", "sonnet", "haiku"]);
});
