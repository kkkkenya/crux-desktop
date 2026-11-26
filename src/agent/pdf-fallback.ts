import { piEngineForSpec, type PiEngine } from "./models.ts";
import { cruxImageModelId, CRUX_HOSTED_PROVIDER } from "./crux-hosted.ts";

/** The plan's image-capable model (Gemini on the Crux relay), for any picture read whose
 *  selected model is text-only. Undefined when the plan has none or it cannot be built. */
export function pdfImageFallback(): PiEngine | undefined {
	const id = cruxImageModelId();
	if (!id) return undefined;
	try {
		return piEngineForSpec({ provider: CRUX_HOSTED_PROVIDER, id });
	} catch {
		return undefined;
	}
}
