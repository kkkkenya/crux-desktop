/**
 * Automatic titles for sessions that were started without a name.
 *
 * Sessions started from a typed opening prompt already take their title from
 * that prompt (titleFromPrompt, on create). A session started with only
 * documents, or with an empty draft, is born "Untitled session". The first
 * message the student actually sends gives it a short title, once. A name the
 * student typed, or one already derived, is never overwritten.
 */
import { titleFromPrompt } from "../src/core/contracts/graph.ts";

export const UNTITLED_SESSION_TITLE = "Untitled session";

/** The title to store after the student sends `message`, or null when the session keeps its title. */
export function autoTitleFromMessage(message: string, currentTitle: string): string | null {
	if (currentTitle.trim() !== UNTITLED_SESSION_TITLE) return null;
	const derived = titleFromPrompt(message);
	return derived.length > 0 ? derived : null;
}
