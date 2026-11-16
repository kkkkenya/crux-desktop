"use client";

/**
 * Crux's own file viewer (2026-11-16), the same as Crux web's (study/web/src/PdfViewer.jsx):
 * a unit's PDFs and marking schemes open inside Crux, each in a tab. Collapsed, the tabs
 * wait in a dock, and the file you were reading stays small and live at the top of the
 * notes panel (the mini reader), with page arrows and Continue reading.
 *
 * Each file is read once and kept in memory (docs below), shared by the full viewer and
 * the mini reader, so switching between them never loads it again. The open tabs and the
 * page each one was on are kept on this computer.
 *
 * Text selected in a PDF, or in a marking scheme (its own script posts the selection,
 * electron/solution-page.cjs), can go straight to the unit's notes: "Add to notes".
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, FileCheck2Icon, FileTextIcon, MessageCircleQuestionIcon, MinusIcon, NotebookPenIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { cruxBridge } from "@/components/crux-study";
import type { CruxBridge } from "@/components/crux-hub";
import { INSERT_TEXT_EVENT } from "@/components/path-input";

// ---------------------------------------------------------------- open tabs (kept on this computer)

export interface ReaderTab { path: string; name: string; kind: "pdf" | "html"; page: number }
interface ReaderState { tabs: ReaderTab[]; active: string | null; expanded: boolean; jump: number }

const KEY = "crux:open-files";
const MAX_TABS = 8;
const listeners = new Set<() => void>();
let state: ReaderState = { tabs: [], active: null, expanded: false, jump: 0 };
let loaded = false;

function load(): void {
	if (loaded || typeof window === "undefined") return;
	loaded = true;
	try {
		const tabs = (JSON.parse(localStorage.getItem(KEY) || "[]") as ReaderTab[])
			.filter((t) => t && typeof t.path === "string" && (t.kind === "pdf" || t.kind === "html")).slice(0, MAX_TABS);
		state = { ...state, tabs, active: tabs[0]?.path ?? null };
	} catch { /* storage blocked: start with no tabs */ }
}
function set(next: Partial<ReaderState>): void {
	state = { ...state, ...next };
	try { localStorage.setItem(KEY, JSON.stringify(state.tabs)); } catch { /* storage blocked */ }
	for (const l of listeners) l();
}
const subscribe = (l: () => void) => { load(); listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => { load(); return state; };
const serverSnapshot = () => state;

/** "EMM 302 notes [12].pdf" → "EMM 302 notes". */
export const shortName = (name: string) => String(name || "File").replace(/ \[\d+\](?=\.[^.]+$)/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ").trim();
/** The unit a Hub file belongs to: the folder under Crux\Hub. */
export function unitOfPath(path: string): string | null {
	const parts = path.split(/[\\/]+/);
	const i = parts.findIndex((p, k) => p === "Hub" && parts[k - 1] === "Crux");
	const unit = i >= 0 ? parts[i + 1] : undefined;
	return unit && /^[A-Z]{2,5} ?\d{3}[A-Z]?$/.test(unit) ? unit : null;
}
/** The tabs after opening a file: it goes first, nothing twice, eight at most. */
export function withOpened(tabs: readonly ReaderTab[], tab: ReaderTab): ReaderTab[] {
	return [tab, ...tabs.filter((t) => t.path !== tab.path)].slice(0, MAX_TABS);
}

/** The message "Ask the tutor" starts: the passage quoted, with its file and page, then room for the question. */
export function askText(text: string, tab: Pick<ReaderTab, "name" | "kind" | "page">): string {
	const NL = String.fromCharCode(10);
	const where = `${shortName(tab.name)}${tab.kind === "pdf" ? `, page ${tab.page}` : ""}`;
	const quoted = text.trim().slice(0, 2000).split(String.fromCharCode(13)).join("").split(NL).map((l) => `> ${l}`).join(NL);
	return `About this passage from ${where}:${NL}${quoted}${NL}${NL}`;
}

/** Open a saved Hub file in Crux's viewer, at a page for PDFs. */
export function openInCrux(file: { path: string; name?: string; page?: number | null }): void {
	load();
	const kind: ReaderTab["kind"] = /\.html?$/i.test(file.path) ? "html" : "pdf";
	const before = state.tabs.find((t) => t.path === file.path);
	const tab: ReaderTab = { path: file.path, name: file.name || file.path.split(/[\\/]/).pop() || "File", kind, page: file.page && file.page > 0 ? file.page : before?.page ?? 1 };
	const tabs = withOpened(state.tabs, tab);
	for (const t of state.tabs) if (!tabs.some((k) => k.path === t.path)) dropDoc(t.path); // the oldest fell off: free it
	set({ tabs, active: tab.path, expanded: true, jump: state.jump + 1 });
}
const activate = (path: string, keepSmall = false) => set({ active: path, jump: state.jump + 1, ...(keepSmall ? {} : { expanded: true }) });
const collapse = () => set({ expanded: false });
function closeTab(path: string): void {
	dropDoc(path);
	const tabs = state.tabs.filter((t) => t.path !== path);
	set({ tabs, active: state.active === path ? tabs[0]?.path ?? null : state.active, expanded: tabs.length ? state.expanded : false });
}
const setPage = (path: string, page: number) => {
	if (state.tabs.some((t) => t.path === path && t.page !== page)) set({ tabs: state.tabs.map((t) => (t.path === path ? { ...t, page } : t)) });
};

// ---------------------------------------------------------------- the memory cache: each file read once

type Pdf = typeof import("pdfjs-dist");
type PdfDoc = Awaited<ReturnType<Pdf["getDocument"]>["promise"]>;
type Loaded = { kind: "pdf"; doc: PdfDoc; ratio: number } | { kind: "html"; html: string; safe: boolean };

let pdfjs: Promise<Pdf> | null = null;
function pdfLib(): Promise<Pdf> {
	pdfjs ??= import("pdfjs-dist").then((lib) => {
		lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
		return lib;
	});
	return pdfjs;
}
const docs = new Map<string, Promise<Loaded>>();
export function loadDoc(bridge: CruxBridge, path: string): Promise<Loaded> {
	let p = docs.get(path);
	if (!p) {
		p = (async (): Promise<Loaded> => {
			const reply = await bridge.bytes!(path);
			if (!reply.ok) throw new Error(reply.error);
			const { bytes, kind, safe } = reply.value;
			if (kind === "html") return { kind, html: new TextDecoder().decode(bytes), safe };
			const lib = await pdfLib();
			const doc = await lib.getDocument({ data: bytes }).promise;
			const first = (await doc.getPage(1)).getViewport({ scale: 1 });
			return { kind: "pdf", doc, ratio: first.height / first.width };
		})().catch((err) => { docs.delete(path); throw err; });
		docs.set(path, p);
	}
	return p;
}
function dropDoc(path: string): void {
	const p = docs.get(path);
	docs.delete(path);
	void p?.then((d) => { if (d.kind === "pdf") void d.doc.loadingTask.destroy(); }).catch(() => {});
}
const texts = new WeakMap<PdfDoc, Map<number, string>>();
async function pageText(doc: PdfDoc, n: number): Promise<string> {
	let m = texts.get(doc);
	if (!m) { m = new Map(); texts.set(doc, m); }
	if (!m.has(n)) {
		const content = await (await doc.getPage(n)).getTextContent();
		m.set(n, content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").toLowerCase());
	}
	return m.get(n)!;
}

// ---------------------------------------------------------------- one PDF page: picture plus selectable text

function Page({ doc, n, width, ratio, onSeen, hit }: { doc: PdfDoc; n: number; width: number; ratio: number; onSeen: (n: number) => void; hit: string }) {
	const box = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const text = useRef<HTMLDivElement>(null);
	const [near, setNear] = useState(false);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		// drawn near the screen, and let go again far from it, so a long book never holds every page in memory
		const io = new IntersectionObserver(([e]) => { if (e) setNear(e.isIntersecting); }, { rootMargin: "1200px 0px" });
		// The page you're on is the one across the middle of the viewer (a page taller than the window never shows half of itself).
		const seen = new IntersectionObserver(([e]) => { if (e?.isIntersecting) onSeen(n); }, { root: el.closest(".crux-pdf-scroll"), rootMargin: "-50% 0px -50% 0px", threshold: 0 });
		io.observe(el); seen.observe(el);
		return () => { io.disconnect(); seen.disconnect(); };
	}, [n, onSeen]);
	useEffect(() => {
		if (!near || !width) return;
		let gone = false;
		let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
		let layer: { cancel: () => void; render: () => Promise<unknown> } | null = null;
		void Promise.all([doc.getPage(n), pdfLib()]).then(([p, lib]) => {
			const c = canvas.current, t = text.current;
			if (gone || !c || !t) return;
			const scale = width / p.getViewport({ scale: 1 }).width;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const vp = p.getViewport({ scale: scale * dpr });
			c.width = vp.width; c.height = vp.height;
			task = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp });
			task.promise.catch(() => {});
			t.replaceChildren();
			t.style.setProperty("--scale-factor", String(scale));
			t.style.setProperty("--total-scale-factor", String(scale));
			layer = new lib.TextLayer({ textContentSource: p.streamTextContent(), container: t, viewport: p.getViewport({ scale }) });
			layer.render().then(() => t.dispatchEvent(new Event("drawn"))).catch(() => {});
		});
		return () => {
			gone = true; task?.cancel(); layer?.cancel();
			const c = canvas.current;
			if (c) { c.width = 0; c.height = 0; }
			text.current?.replaceChildren();
		};
	}, [near, width, doc, n]);
	useEffect(() => {
		const t = text.current;
		if (!t) return;
		const light = () => t.querySelectorAll("span").forEach((x) => x.classList.toggle("crux-pdf-hit", Boolean(hit) && (x.textContent ?? "").toLowerCase().includes(hit)));
		light();
		t.addEventListener("drawn", light);
		return () => t.removeEventListener("drawn", light);
	}, [hit]);
	return (
		<div ref={box} className="crux-pdf-page" data-page={n} style={{ width, height: width * ratio }}>
			<canvas ref={canvas} aria-label={`Page ${n}`} />
			<div ref={text} className="textLayer" />
		</div>
	);
}

// ---------------------------------------------------------------- the full viewer

function PdfReader({ doc, ratio, tab }: { doc: PdfDoc; ratio: number; tab: ReaderTab }) {
	const [at, setAt] = useState(tab.page || 1);
	const [zoom, setZoom] = useState(1);
	const [fit, setFit] = useState(0);
	const [goTo, setGoTo] = useState("");
	const [find, setFind] = useState("");
	const [found, setFound] = useState<{ q: string; page?: number; none?: boolean; looking?: number } | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const findBox = useRef<HTMLInputElement>(null);
	const jumped = useRef(false);
	useEffect(() => {
		const size = () => setFit(Math.min(scroller.current?.clientWidth || 800, 900) - 16);
		size();
		window.addEventListener("resize", size);
		return () => window.removeEventListener("resize", size);
	}, []);
	const go = useCallback((n: number) => scroller.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ block: "start" }), []);
	useEffect(() => {
		if (fit && !jumped.current) { jumped.current = true; requestAnimationFrame(() => go(Math.min(tab.page || 1, doc.numPages))); }
	}, [fit, doc, tab.page, go]);
	useEffect(() => { setPage(tab.path, at); }, [at, tab.path]);
	useEffect(() => {
		const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); findBox.current?.focus(); findBox.current?.select(); } };
		document.addEventListener("keydown", key, true);
		return () => document.removeEventListener("keydown", key, true);
	}, []);
	const search = async (e: React.FormEvent) => {
		e.preventDefault();
		const q = find.trim().toLowerCase().replace(/\s+/g, " ");
		if (!q) return;
		const from = found?.q === q && found.page ? found.page : at - 1;
		for (let i = 1; i <= doc.numPages; i++) {
			const n = ((from + i - 1) % doc.numPages) + 1;
			if (i % 10 === 1) setFound({ q, looking: n });
			try { if ((await pageText(doc, n)).includes(q)) { setFound({ q, page: n }); go(n); return; } } catch { /* a page that won't load is skipped */ }
		}
		setFound({ q, none: true });
	};
	const width = Math.round(fit * zoom);
	return (
		<>
			<div className="crux-pdf-tools">
				<button type="button" className="crux-iconbtn" aria-label="Previous page" disabled={at <= 1} onClick={() => go(at - 1)}><ChevronLeftIcon /></button>
				<form className="crux-pdf-goto" onSubmit={(e) => { e.preventDefault(); const n = Math.round(Number(goTo)); if (n >= 1 && n <= doc.numPages) go(n); setGoTo(""); }}>
					<input inputMode="numeric" value={goTo} onChange={(e) => setGoTo(e.target.value.replace(/\D/g, ""))} placeholder={String(at)} aria-label={`Go to page (1 to ${doc.numPages})`} title="Type a page and press Enter" />
					<span>/ {doc.numPages}</span>
				</form>
				<button type="button" className="crux-iconbtn" aria-label="Next page" disabled={at >= doc.numPages} onClick={() => go(at + 1)}><ChevronRightIcon /></button>
				<button type="button" className="crux-iconbtn" aria-label="Smaller" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><MinusIcon /></button>
				<button type="button" className="crux-iconbtn" aria-label="Larger" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><PlusIcon /></button>
				<form className="crux-pdf-find" role="search" onSubmit={(e) => void search(e)}>
					<SearchIcon aria-hidden />
					<input ref={findBox} value={find} onChange={(e) => { setFind(e.target.value); setFound(null); }} placeholder="Find in file" aria-label="Find in this file" />
					{found && <span role="status">{found.looking ? `p. ${found.looking}…` : found.none ? "Not found" : `p. ${found.page} · Enter for next`}</span>}
				</form>
			</div>
			<div className="crux-pdf-scroll" ref={scroller} data-crux-reader-text>
				{Array.from({ length: doc.numPages }, (_, i) => (
					<Page key={i + 1} doc={doc} n={i + 1} width={width} ratio={ratio} onSeen={setAt} hit={found?.page ? found.q : ""} />
				))}
			</div>
		</>
	);
}

function HtmlReader({ html, tab }: { html: string; tab: ReaderTab }) {
	return (
		<div className="crux-pdf-scroll crux-html-scroll">
			<iframe title={shortName(tab.name)} sandbox="allow-scripts" srcDoc={html} className="crux-html-page" data-crux-frame={tab.path} />
		</div>
	);
}

function Reader({ bridge, tab }: { bridge: CruxBridge; tab: ReaderTab }) {
	const [doc, setDoc] = useState<Loaded | null>(null);
	const [problem, setProblem] = useState("");
	useEffect(() => {
		let gone = false;
		setDoc(null); setProblem("");
		loadDoc(bridge, tab.path).then((d) => { if (!gone) setDoc(d); }).catch((err: Error) => { if (!gone) setProblem(err.message || "The file could not be opened."); });
		return () => { gone = true; };
	}, [bridge, tab.path]);
	if (problem) return <div className="crux-pdf-scroll"><p role="alert" className="crux-pdf-note">{problem}</p></div>;
	if (!doc) return <div className="crux-pdf-scroll"><div className="crux-pdf-loading"><div className="crux-skeleton" /><p>Opening{tab.kind === "pdf" && tab.page > 1 ? ` at page ${tab.page}` : ""}…</p></div></div>;
	if (doc.kind === "html") {
		if (!doc.safe) {
			return (
				<div className="crux-pdf-scroll">
					<p className="crux-pdf-note">This page was not made by Crux, so it opens in your browser. <button type="button" className="underline" onClick={() => void bridge.openLocal?.(tab.path, null)}>Open it</button></p>
				</div>
			);
		}
		return <HtmlReader html={doc.html} tab={tab} />;
	}
	return <PdfReader doc={doc.doc} ratio={doc.ratio} tab={tab} />;
}

// ---------------------------------------------------------------- the mini reader in the notes panel

function Mini({ bridge, tabs, tab }: { bridge: CruxBridge; tabs: ReaderTab[]; tab: ReaderTab }) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const box = useRef<HTMLButtonElement>(null);
	const [info, setInfo] = useState<{ pages: number } | null>(null);
	const [html, setHtml] = useState<string | null>(null);
	const [problem, setProblem] = useState("");
	const [turn, setTurn] = useState<"" | "next" | "prev">("");
	const page = tab.page || 1;
	useEffect(() => {
		let gone = false;
		let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
		setProblem("");
		loadDoc(bridge, tab.path).then(async (d) => {
			if (gone) return;
			if (d.kind === "html") { setHtml(d.safe ? d.html : null); setInfo(null); return; }
			setHtml(null);
			setInfo({ pages: d.doc.numPages });
			const p = await d.doc.getPage(Math.min(page, d.doc.numPages));
			const c = canvas.current;
			if (gone || !c) return;
			const width = box.current?.clientWidth || 300;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const vp = p.getViewport({ scale: (width / p.getViewport({ scale: 1 }).width) * dpr });
			c.width = vp.width; c.height = vp.height;
			task = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp });
			await task.promise.catch(() => {});
		}).catch((err: Error) => { if (!gone) setProblem(err.message || "The file could not be opened."); });
		return () => { gone = true; task?.cancel(); };
	}, [bridge, tab.path, page]);
	const go = (n: number) => { if (!info || n < 1 || n > info.pages) return; setTurn(n > page ? "next" : "prev"); setPage(tab.path, n); };
	return (
		<section className="crux-mini" aria-label={`Reading ${shortName(tab.name)}`} data-testid="crux-mini-reader">
			<div className="crux-mini-head">
				<span className="crux-mini-live" aria-hidden />
				<span className="crux-mini-name" title={shortName(tab.name)}>{shortName(tab.name)}</span>
				<button type="button" className="crux-iconbtn" aria-label={`Close ${shortName(tab.name)}`} onClick={() => closeTab(tab.path)}><XIcon /></button>
			</div>
			<button type="button" ref={box} className={`crux-mini-page ${turn}`} key={`${tab.path}:${page}`} onClick={() => activate(tab.path)} aria-label={tab.kind === "pdf" ? `Continue reading at page ${page}` : "Continue reading"}>
				{tab.kind === "pdf" ? <canvas ref={canvas} /> : html ? <iframe title="" tabIndex={-1} aria-hidden sandbox="" srcDoc={html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")} className="crux-mini-html" /> : null}
				{problem && <span className="crux-mini-problem">{problem}</span>}
				<span className="crux-mini-go"><FileTextIcon aria-hidden /> Continue reading</span>
			</button>
			{tab.kind === "pdf" && (
				<div className="crux-mini-foot">
					<button type="button" className="crux-iconbtn" aria-label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeftIcon /></button>
					<span className="crux-mini-at">p. {page}{info ? ` / ${info.pages}` : ""}</span>
					<button type="button" className="crux-iconbtn" aria-label="Next page" disabled={!info || page >= info.pages} onClick={() => go(page + 1)}><ChevronRightIcon /></button>
				</div>
			)}
			{tabs.length > 1 && (
				<div className="crux-mini-tabs">
					{tabs.filter((t) => t.path !== tab.path).map((t) => (
						<button key={t.path} type="button" onClick={() => activate(t.path, true)} title={shortName(t.name)}>{shortName(t.name)}{t.kind === "pdf" ? ` · p. ${t.page || 1}` : ""}</button>
					))}
				</div>
			)}
		</section>
	);
}

// ---------------------------------------------------------------- "Add to notes" for text selected in a file

function AddToNotes({ bridge, tab }: { bridge: CruxBridge; tab: ReaderTab | undefined }) {
	const [at, setAt] = useState<{ x: number; y: number; text: string } | null>(null);
	const [said, setSaid] = useState("");
	useEffect(() => {
		// a PDF's text layer: the selection is in this document
		const look = () => {
			const sel = window.getSelection();
			const text = sel?.toString().trim() ?? "";
			const node = sel?.anchorNode ?? null;
			const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
			if (!sel || sel.rangeCount === 0 || text.length < 2 || !el?.closest("[data-crux-reader-text]")) { setAt(null); return; }
			const r = sel.getRangeAt(0).getBoundingClientRect();
			setAt({ x: Math.min(Math.max((r.left + r.right) / 2, 150), window.innerWidth - 150), y: Math.max(r.top - 40, 8), text: text.slice(0, 2000) });
		};
		const up = () => window.setTimeout(look, 0);
		// a marking scheme in its frame: its own script posts what is selected
		const message = (e: MessageEvent) => {
			const frame = document.querySelector<HTMLIFrameElement>("iframe[data-crux-frame]");
			if (!frame || e.source !== frame.contentWindow || typeof e.data?.cruxSelection !== "string") return;
			const text = e.data.cruxSelection.trim();
			if (text.length < 2) { setAt(null); return; }
			const r = frame.getBoundingClientRect();
			setAt({ x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: r.top + 12, text: text.slice(0, 2000) });
		};
		document.addEventListener("mouseup", up);
		document.addEventListener("keyup", up);
		window.addEventListener("message", message);
		return () => { document.removeEventListener("mouseup", up); document.removeEventListener("keyup", up); window.removeEventListener("message", message); };
	}, []);
	useEffect(() => { if (!said) return; const t = window.setTimeout(() => setSaid(""), 2200); return () => window.clearTimeout(t); }, [said]);
	const add = async () => {
		if (!at || !tab) return;
		const page = tab.kind === "pdf" ? ` · p. ${tab.page}` : "";
		const reply = await bridge.addNote({ text: at.text, unit: unitOfPath(tab.path), from: `${shortName(tab.name)}${page}`.slice(0, 100) }).catch(() => null);
		setAt(null);
		window.getSelection()?.removeAllRanges();
		setSaid(reply?.ok ? "Added to notes" : reply ? reply.error : "The note was not saved. Check your connection.");
		if (reply?.ok) window.dispatchEvent(new CustomEvent("crux:note-added", { detail: reply.value }));
	};
	// "Ask the tutor" (DeepTutor's Little Tutor, fixplan-e E4): the passage goes into the message box with where it came
	// from, the viewer folds away, and the student types the question. Nothing is sent until they send it.
	const ask = () => {
		if (!at || !tab) return;
		const editor = document.querySelector<HTMLElement>("[data-file-path-default]");
		setAt(null);
		window.getSelection()?.removeAllRanges();
		if (!editor) { setSaid("Open a session first, then ask about it."); return; }
		collapse();
		editor.dispatchEvent(new CustomEvent(INSERT_TEXT_EVENT, { detail: askText(at.text, tab) }));
	};
	return (
		<>
			{at && (
				<span style={{ left: at.x, top: at.y }} className="crux-addnote-bar">
					<button type="button" data-testid="reader-add-note" onMouseDown={(e) => e.preventDefault()} onClick={() => void add()} className="crux-addnote crux-glass">
						<NotebookPenIcon aria-hidden />Add to notes
					</button>
					<button type="button" data-testid="reader-ask" onMouseDown={(e) => e.preventDefault()} onClick={ask} className="crux-addnote crux-glass">
						<MessageCircleQuestionIcon aria-hidden />Ask the tutor
					</button>
				</span>
			)}
			{said && <p role="status" className="crux-addnote-said crux-glass">{said}</p>}
		</>
	);
}

// ---------------------------------------------------------------- the viewer, mounted once in the session window

export function CruxReader() {
	const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
	const [bridge, setBridge] = useState<CruxBridge | undefined>(undefined);
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	useEffect(() => { setBridge(cruxBridge()); }, []);
	// a marking scheme the tutor saved opens here as a tab
	useEffect(() => bridge?.onOpen?.((file) => { if (file && typeof file.path === "string") openInCrux(file); }), [bridge]);
	// "Open at page" in a study guide (crux-study.tsx OpenAtButton)
	useEffect(() => {
		const open = (e: Event) => { const f = (e as CustomEvent<{ path: string; name: string; page: number | null }>).detail; if (f?.path) openInCrux(f); };
		window.addEventListener("crux:open-file", open);
		return () => window.removeEventListener("crux:open-file", open);
	}, []);
	// the notes panel's slot for the mini reader comes and goes with the panel
	useEffect(() => {
		const find = () => setSlot(document.getElementById("crux-reading"));
		find();
		window.addEventListener("crux:notes-panel", find);
		return () => window.removeEventListener("crux:notes-panel", find);
	}, []);
	useEffect(() => {
		if (!s.expanded) return;
		const esc = (e: KeyboardEvent) => { if (e.key === "Escape") collapse(); };
		document.addEventListener("keydown", esc);
		return () => document.removeEventListener("keydown", esc);
	}, [s.expanded]);
	if (!bridge?.bytes) return null;
	const tab = s.tabs.find((t) => t.path === s.active) ?? s.tabs[0];
	if (!tab) return null;
	const strip = (
		<div className="crux-pdf-tabs" role="tablist" aria-label="Open files">
			{s.tabs.map((t) => (
				<span key={t.path} className="crux-pdf-tab" role="presentation">
					<button type="button" role="tab" aria-selected={s.expanded && t.path === tab.path} onClick={() => activate(t.path)} title={shortName(t.name)}>
						{t.kind === "html" ? <FileCheck2Icon aria-hidden /> : <FileTextIcon aria-hidden />}
						<span className="crux-pdf-tab-name">{shortName(t.name)}</span>
						{t.kind === "pdf" && <span className="crux-pdf-tab-page">p. {t.page || 1}</span>}
					</button>
					<button type="button" className="crux-pdf-tab-x" aria-label={`Close ${shortName(t.name)}`} onClick={() => closeTab(t.path)}><XIcon /></button>
				</span>
			))}
		</div>
	);
	return (
		<>
			{s.expanded ? (
				<div className="crux-pdfview lh-no-drag" role="dialog" aria-modal="true" aria-label={shortName(tab.name)} data-testid="crux-reader">
					<header className="crux-pdf-bar crux-glass">
						<button type="button" className="crux-iconbtn" aria-label="Collapse the viewer" title="Collapse (Esc)" onClick={collapse}><ChevronDownIcon /></button>
						{strip}
					</header>
					<Reader key={`${tab.path}:${s.jump}`} bridge={bridge} tab={tab} />
				</div>
			) : (
				<nav className="crux-pdf-dock crux-glass lh-no-drag" aria-label="Open files" data-testid="crux-reader-dock">{strip}</nav>
			)}
			{!s.expanded && slot && createPortal(<Mini bridge={bridge} tabs={s.tabs} tab={tab} />, slot)}
			<AddToNotes bridge={bridge} tab={tab} />
		</>
	);
}
