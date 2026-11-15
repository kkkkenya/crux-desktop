/**
 * Hub files: several files at once (owner, 2026-11-15). Each row has a tick box named after its file, next to the
 * row's own Download or Add to session.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileRow } from "@/components/crux-hub";

const noop = () => {};
const file = { id: "1787", name: "EMM302_CAT_1.pdf", kind: "paper", paper: true, pages: 3, path: null } as never;

describe("Hub file row", () => {
	it("has a tick box named after the file, unticked by default", () => {
		const html = renderToStaticMarkup(<FileRow file={file} busy={false} picked={false} onPick={noop} onDownload={noop} onAdd={noop} onReveal={noop} />);
		assert.match(html, /type="checkbox"/);
		assert.match(html, /aria-label="Select EMM302_CAT_1.pdf"/);
		assert.ok(!/checked=""/.test(html));
		assert.match(html, /data-testid="hub-download"/);
	});

	it("shows the tick when picked, and keeps Add to session for a saved file", () => {
		const saved = { ...(file as object), path: "C:/Hub/EMM 302/EMM302_CAT_1 [1787].pdf" } as never;
		const html = renderToStaticMarkup(<FileRow file={saved} busy={false} picked onPick={noop} onDownload={noop} onAdd={noop} onReveal={noop} />);
		assert.match(html, /checked=""/);
		assert.match(html, /data-testid="hub-add"/);
	});
});

describe("Hub file row page count", () => {
	it("says nothing about pages when Crux does not know them (0 or null), and counts them when it does", () => {
		for (const pages of [0, null]) {
			const html = renderToStaticMarkup(<FileRow file={{ ...(file as object), pages } as never} busy={false} picked={false} onPick={noop} onDownload={noop} onAdd={noop} onReveal={noop} />);
			assert.ok(!/pages?</.test(html), `pages = ${pages}`);
		}
		const html = renderToStaticMarkup(<FileRow file={file} busy={false} picked={false} onPick={noop} onDownload={noop} onAdd={noop} onReveal={noop} />);
		assert.match(html, /3 pages/);
	});
});
