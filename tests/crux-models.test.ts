/**
 * Track H1 (owner, 2026-11-20): DeepSeek is the first Crux model. A model slot or a saved session that
 * still names paused GLM opens on DeepSeek (src/core/crux-models.ts), so the composer never shows a
 * model the relay no longer offers. Uses a throwaway LH_DATA_DIR.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crux-models-"));
process.env.LH_DATA_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { cruxLiveModel } = await import("../src/core/crux-models.ts");
const { resolveSettings, resolveConversationSpec } = await import("../src/core/settings-resolution.ts");
const { chatStore } = await import("../src/store/chats.ts");

it("cruxLiveModel: paused Crux GLM becomes DeepSeek; everything else is left alone", () => {
	assert.deepEqual(cruxLiveModel({ provider: "crux", id: "glm-5.3" }), { provider: "crux", id: "deepseek-flash" });
	assert.deepEqual(cruxLiveModel({ provider: "crux", id: "glm-5.3-flash" }), { provider: "crux", id: "deepseek-flash" });
	assert.deepEqual(cruxLiveModel({ provider: "crux", id: "gemini-3.8-flash" }), { provider: "crux", id: "gemini-4-hydrogen" }, "3.8 Flash was replaced by Hydrogen");
	assert.deepEqual(cruxLiveModel({ provider: "crux", id: "gemini-4-hydrogen" }), { provider: "crux", id: "gemini-4-hydrogen" });
	assert.deepEqual(cruxLiveModel({ provider: "google", id: "gemini-3.8-flash" }), { provider: "google", id: "gemini-3.8-flash" }, "a student's own Google key is theirs");
	assert.deepEqual(cruxLiveModel({ provider: "zai", id: "glm-5.3" }), { provider: "zai", id: "glm-5.3" }, "a student's own z.ai key is theirs");
	assert.equal(cruxLiveModel(undefined), undefined);
});

it("a strong slot saved on Crux GLM resolves to DeepSeek (the new-session default)", () => {
	const eff = resolveSettings({ models: { strong: { model: { provider: "crux", id: "glm-5.3" }, thinkingLevel: "medium" } } } as never);
	assert.deepEqual({ provider: eff.models.strong?.provider, id: eff.models.strong?.id, level: eff.models.strong?.thinkingLevel }, { provider: "crux", id: "deepseek-flash", level: "medium" });
	const spec = resolveConversationSpec({ model: { provider: "crux", id: "glm-5.3-flash" } } as never, eff.models.strong);
	assert.equal(spec?.id, "deepseek-flash");
});

it("a session saved on Crux GLM opens on DeepSeek", () => {
	const chat = chatStore.createChat("GLM session");
	chatStore.saveSettings(chat.id, { model: { provider: "crux", id: "glm-5.3" }, thinkingLevel: "medium" });
	const opened = chatStore.getChat(chat.id);
	assert.deepEqual(opened?.settings?.model, { provider: "crux", id: "deepseek-flash" });
});

it("the saved settings themselves read as DeepSeek: the composer label and new sessions use them (found in the installed 0.7.1)", async () => {
	const { readSettings } = await import("../src/store/settings.ts");
	const { SETTINGS_FILE } = await import("../config.ts");
	fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
	fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ version: 1, models: { strong: { model: { provider: "crux", id: "glm-5.3" }, thinkingLevel: "medium" }, cheap: { model: { provider: "claude-code", id: "haiku" } } } }));
	const record = readSettings();
	assert.deepEqual(record?.models?.strong?.model, { provider: "crux", id: "deepseek-flash" });
	assert.equal(record?.models?.strong?.thinkingLevel, "medium");
	assert.deepEqual(record?.models?.cheap?.model, { provider: "claude-code", id: "haiku" });
});
