/**
 * Hosted models through Crux (owner, 2026-11-12): students need no API key.
 *
 * Crux web runs an OpenAI-compatible relay (study/server/ai-relay.js) that picks
 * the models for the student's plan, counts their daily answers, and calls
 * Gemini, DeepSeek or GLM with the Hub's own keys. This provider points at it.
 * Its key is a 12-hour relay key the Electron main process gets with the
 * student's Crux session (electron/crux-hub.cjs aiToken) and hands over the
 * private IPC channel; it is fetched again when it nears expiry.
 *
 * The model list comes from the relay (the plan decides it) and is refreshed in
 * the background every 10 minutes. Outside the desktop app there is no provider.
 */
import { createProvider, type Api, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { cruxDesktopConnected, cruxRequest } from "./crux-bridge.ts";

export const CRUX_HOSTED_PROVIDER = "crux";
export const CRUX_BUSY_MARK = "[crux:gemini-busy]";
const ORIGIN = (process.env.CRUX_ORIGIN || "https://crux.engineeringhub.site").replace(/\/+$/, "");
export const CRUX_RELAY_BASE = `${ORIGIN}/api/ai/v1`;
const REFRESH_MS = 10 * 60 * 1000;

export interface RelayModel { id: string; name?: string; context_length?: number; max_tokens?: number; image?: boolean; reasoning?: boolean }

let models: RelayModel[] = [];
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;

async function relayKey(): Promise<string> {
	const reply = await cruxRequest<{ token: string }>("aiToken");
	if (!reply.ok) throw new Error(reply.error);
	return reply.value.token;
}

/** Pure: the relay's model list as pi models. */
export function toCruxModels(list: readonly RelayModel[], baseUrl = CRUX_RELAY_BASE): Model<Api>[] {
	return list.filter((m) => typeof m?.id === "string" && m.id).map((m) => ({
		id: m.id,
		name: m.name || m.id,
		api: "openai-completions",
		provider: CRUX_HOSTED_PROVIDER,
		baseUrl,
		reasoning: m.reasoning === true,
		input: m.image ? ["text", "image"] : ["text"],
		// Billed to the Hub, not the student: no price shown.
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: Number.isFinite(m.context_length) && m.context_length! > 0 ? m.context_length! : 131072,
		maxTokens: Number.isFinite(m.max_tokens) && m.max_tokens! > 0 ? m.max_tokens! : 8192,
		type: "chat",
	}) as Model<Api>);
}

/** Fetch the plan's models from the relay (background; never throws). */
export function refreshCruxHosted(force = false): Promise<void> {
	if (!cruxDesktopConnected()) return Promise.resolve();
	if (!force && Date.now() - fetchedAt < REFRESH_MS) return Promise.resolve();
	if (inFlight) return inFlight;
	inFlight = (async () => {
		try {
			const key = await relayKey();
			const r = await fetch(`${CRUX_RELAY_BASE}/models`, { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, redirect: "error" });
			if (r.ok) {
				const body = await r.json() as { data?: RelayModel[] };
				models = Array.isArray(body?.data) ? body.data : [];
			} else if (r.status === 401 || r.status === 403) models = [];
		} catch { /* offline or signed out: keep the last list until the next try */ }
		fetchedAt = Date.now();
		inFlight = null;
	})();
	return inFlight;
}

export function cruxHostedReady(): boolean {
	return cruxDesktopConnected() && models.length > 0;
}

/** The provider for the model collection, or null when there is nothing to offer. */
export function cruxHostedProvider(): Provider<Api> | null {
	if (!cruxHostedReady()) return null;
	return createProvider<Api>({
		id: CRUX_HOSTED_PROVIDER,
		name: "Crux",
		baseUrl: CRUX_RELAY_BASE,
		auth: { apiKey: { name: "Crux account", resolve: async () => ({ auth: { apiKey: await relayKey() }, source: "Crux account" }) } },
		models: toCruxModels(models),
		api: openAICompletionsApi(),
	});
}

/** A model fingerprint, so the collection is only rebuilt when the plan's list changes. */
export const cruxHostedFingerprint = (): string => (cruxHostedReady() ? models.map((m) => m.id).join(",") : "");

/** Test seam. */
export function setCruxHostedModelsForTest(list: RelayModel[]): void { models = list; fetchedAt = Date.now(); }
