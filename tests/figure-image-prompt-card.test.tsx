import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VisualOutputCard } from "../components/artifacts/visual-card.tsx";
import { IMAGE_AI_URL } from "../components/artifacts/image-prompt-action.tsx";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="40" height="20"><line x1="0" y1="10" x2="40" y2="10"/></svg>';

describe("VisualOutputCard image prompt option", () => {
	it("offers Copy image prompt, a Gemini link and the readable prompt when the figure has one", () => {
		const html = renderToStaticMarkup(
			<VisualOutputCard output={{ svg: SVG, notes: "ok", imagePrompt: "Draw a beam.\nP = 10 kN, downward, acting at B" }} />,
		);
		assert.match(html, /data-testid="visual-copy-prompt"/);
		assert.match(html, />Copy image prompt</);
		assert.match(html, new RegExp(`href="${IMAGE_AI_URL.replace(/[.\/]/g, "\\$&")}"`));
		assert.match(html, /Show the prompt/);
		assert.match(html, /P = 10 kN, downward, acting at B/);
	});

	it("shows no image prompt option for a figure without one", () => {
		const html = renderToStaticMarkup(<VisualOutputCard output={{ svg: SVG, notes: "ok" }} />);
		assert.doesNotMatch(html, /visual-copy-prompt/);
		assert.doesNotMatch(html, /Copy image prompt/);
	});
});
