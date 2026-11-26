import assert from "node:assert/strict";
import { it } from "node:test";
import { autoTitleFromMessage, UNTITLED_SESSION_TITLE } from "../lib/session-title.ts";

it("gives an untitled session a short title from the first message", () => {
	assert.equal(autoTitleFromMessage("  Explain   Bayes' theorem\nwith an example  ", UNTITLED_SESSION_TITLE), "Explain Bayes' theorem with an example");
});

it("never overwrites a name the student typed or one already derived", () => {
	assert.equal(autoTitleFromMessage("Something else", "Fluid mechanics revision"), null);
	assert.equal(autoTitleFromMessage("Something else", "Explain Bayes"), null);
});

it("cuts a long first message at a word boundary within the cap", () => {
	const title = autoTitleFromMessage("word ".repeat(40), UNTITLED_SESSION_TITLE);
	assert.ok(title && title.length <= 73 && title.endsWith("…") && !title.includes(" …"));
});

it("keeps the session untitled when the message is blank", () => {
	assert.equal(autoTitleFromMessage("   \n ", UNTITLED_SESSION_TITLE), null);
});
