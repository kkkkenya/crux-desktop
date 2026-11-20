/**
 * Crux hosted-model errors, as the student reads them (owner, 2026-11-20, Track H3). Pure and client-safe.
 *
 * The relay (study/server/ai-relay.js, its table in study/server/ai-errors.js) already answers every upstream
 * failure in one plain sentence, and moves to the next live model itself when the failure isn't the student's.
 * What reaches the desktop is that sentence behind the SDK's status prefix ("503 …"), or the SDK's own wording
 * for what the relay can't see: the student's connection, a timeout, a stream cut off. Anything else (a raw body,
 * a stack) becomes a plain "try again"; the raw text belongs in the log (redactKeys), never on screen.
 */

const OFFLINE = "Can't reach Crux. Check your internet connection and try again.";
const SLOW = "The model took too long to answer. Try again or pick another model.";
const CUT = "The answer stopped partway. Send your message again.";
const REFUSED = "The model wouldn't answer that. Rephrase the question and try again.";
const UNKNOWN = "The model didn't answer. Try again in a moment.";

/** Pure: keys and bearer tokens out of a log line. */
export function redactKeys(text: string): string {
	return String(text ?? "")
		.replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [key]")
		.replace(/\bsk-[\w-]{8,}/g, "[key]")
		.replace(/\bAIza[\w-]{20,}/g, "[key]")
		.replace(/((?:api[_-]?)?key[=:]\s*)[\w.-]{8,}/gi, "$1[key]");
}

/** Pure: the one sentence the student sees for a Crux hosted-model failure. */
export function cruxErrorText(raw: unknown): string {
	const text = String(raw ?? "").trim();
	const line = text.split("\n")[0]!.trim().replace(/^(?:Error:\s*)?\d{3}\s+(?:status code\s*)?/i, "");
	if (/^connection error\.?$|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network ?error|getaddrinfo/i.test(text)) return OFFLINE;
	if (/^request timed out\.?$|ETIMEDOUT|timed out/i.test(line)) return SLOW;
	if (/^terminated$|premature close|socket hang up|other side closed|finish_reason: network_error/i.test(line)) return CUT;
	if (/content_filter/i.test(line)) return REFUSED;
	// The relay's own sentence: plain words that end a sentence, no body, no stack, no address.
	if (line.length <= 280 && /^[A-Z][^{}<>\[\]\\]*[.!?]$/.test(line) && !/\b(?:Error|Exception|https?:|undefined|null)\b/.test(line) && !/\n\s+at /.test(text)) return line;
	return UNKNOWN;
}
