/**
 * Crux hosted models that are paused (owner, 2026-11-20, Track H1). DeepSeek is the first
 * model on every plan; GLM is paused (the z.ai account has no credit). A model slot or a
 * saved session that still names a paused Crux model opens on DeepSeek instead of a model
 * the relay no longer offers. Mirrors `off: true` in study/server/ai-relay.js MODELS.
 * Pure: no I/O, safe for core.
 */
export const CRUX_PROVIDER = "crux";
export const CRUX_FIRST_MODEL = "deepseek-flash";
export const CRUX_PAUSED_MODELS: ReadonlySet<string> = new Set(["glm-5.3", "glm-5.3-flash"]);
/** Crux models replaced by a newer one (owner, 2026-11-26): a slot or session on the old id opens on the new one.
 *  Mirrors GEMINI_OLD in study/server/gemini-compat.js (the relay also accepts the old id). */
export const CRUX_RENAMED_MODELS: Readonly<Record<string, string>> = { "gemini-3.8-flash": "gemini-4-hydrogen" };

export interface ModelRef { provider: string; id: string }

/** The model to run in place of `model`: DeepSeek for a paused Crux model, the new id for a replaced one,
 *  otherwise `model` itself. */
export function cruxLiveModel<T extends ModelRef | undefined | null>(model: T): T | ModelRef {
	if (model && model.provider === CRUX_PROVIDER && CRUX_PAUSED_MODELS.has(model.id)) {
		return { ...model, provider: CRUX_PROVIDER, id: CRUX_FIRST_MODEL };
	}
	if (model && model.provider === CRUX_PROVIDER && Object.hasOwn(CRUX_RENAMED_MODELS, model.id)) {
		return { ...model, id: CRUX_RENAMED_MODELS[model.id] };
	}
	return model;
}
