"use client";

/**
 * Code cells in Crux Harness (fixplan-g G6, the same engines as Crux web's CodeCell): Python, SQL or JavaScript,
 * run in this window, nothing to install. The Code chip in a session's top bar opens a panel beside the lesson; Ask
 * the tutor puts the code, its output and any error into the message box. Engines live in /engines (plain files,
 * loaded the first time each language runs). On a paired phone the same files come through Study from your phone.
 */
import { useEffect, useRef, useState } from "react";
import { CodeIcon, XIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";
import { INSERT_TEXT_EVENT } from "@/components/path-input";
import { languageOf } from "@/lib/code/code-check.js";
import { resultText } from "@/lib/code/sql-run.js";

type Lang = "python" | "sql" | "js";
const LANGS: Record<Lang, string> = { python: "Python", sql: "SQL", js: "JavaScript" };
const PLACEHOLDER: Record<Lang, string> = { python: "n = int(input())\nprint(n * 2)", sql: "CREATE TABLE t (name TEXT, marks INT);\nINSERT INTO t VALUES ('Amina', 72);\nSELECT * FROM t;", js: "const n = Number(input());\nconsole.log(n * 2);" };
const KEY = "crux:code";
type Result = { stopped?: boolean; out?: string; truncated?: boolean; blocked?: string | null; error?: { line: number | null; type: string; message: string } | null; results?: { columns: string[]; rows: unknown[][]; truncated: boolean }[]; changes?: number };

function runCode(code: string, input: string, lang: Lang): Promise<Result> {
	return new Promise((resolve) => {
		const w = new Worker("/engines/code-worker.js");
		const stop = setTimeout(() => { w.terminate(); resolve({ stopped: true }); }, 4000);
		w.onmessage = ({ data }) => { clearTimeout(stop); w.terminate(); resolve(data.ok ? data.result : { out: "", error: { line: null, type: "Error", message: data.error } }); };
		w.onerror = (e) => { clearTimeout(stop); w.terminate(); resolve({ out: "", error: { line: null, type: "Error", message: e.message || "The code cell could not start." } }); };
		w.postMessage({ code, input, lang });
	});
}

const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") as { lang?: Lang; code?: string; input?: string }; } catch { return {}; } };

export function CodePanel({ onClose }: { onClose: () => void }) {
	const first = useRef(saved());
	const [lang, setLang] = useState<Lang>(first.current.lang ?? "python");
	const [code, setCode] = useState(first.current.code ?? "");
	const [input, setInput] = useState(first.current.input ?? "");
	const [res, setRes] = useState<Result | null>(null);
	const [busy, setBusy] = useState(false);
	const [said, setSaid] = useState("");
	useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ lang, code, input })); } catch { /* storage blocked */ } }, [lang, code, input]);
	const run = async () => { setBusy(true); setSaid(""); setRes(await runCode(code, input, lang)); setBusy(false); };
	const outputText = (r: Result | null) => !r ? "" : r.stopped ? "Stopped: it ran for more than 3 seconds."
		: lang === "sql" ? (r.error ? "" : (r.results ?? []).map((x) => resultText(x)).join("\n\n") || `${r.changes ?? 0} rows changed.`) : (r.out ?? "");
	const ask = () => {
		const editor = document.querySelector<HTMLElement>("[data-file-path-default]");
		if (!editor) { setSaid("Open a session first, then ask about your code."); return; }
		const err = res?.error ? `\nError: ${res.error.type}${res.error.line ? ` on line ${res.error.line}` : ""}: ${res.error.message}` : "";
		const out = outputText(res);
		const text = `My ${LANGS[lang]} code:\n\`\`\`${lang === "js" ? "javascript" : lang}\n${code}\n\`\`\`\n${out ? `Output:\n\`\`\`\n${out.slice(0, 2000)}\n\`\`\`\n` : ""}${err}\n\n`;
		editor.dispatchEvent(new CustomEvent(INSERT_TEXT_EVENT, { detail: text }));
		setSaid("Added to your message. Type your question and send.");
	};
	return (
		<aside className="crux-code-panel crux-glass lh-no-drag" aria-label="Code" data-testid="code-panel">
			<header className="flex items-center gap-2">
				<CodeIcon className="size-4 text-primary" aria-hidden />
				<b className="flex-1 text-sm">Code</b>
				<select className="crux-room-input py-1 text-xs" aria-label="Language" value={lang} onChange={(e) => { setLang(e.target.value as Lang); setRes(null); }}>
					{(Object.keys(LANGS) as Lang[]).map((l) => <option key={l} value={l}>{LANGS[l]}</option>)}
				</select>
				<Button size="icon-sm" variant="ghost" className="cursor-pointer" aria-label="Close" onClick={onClose}><XIcon className="size-4" /></Button>
			</header>
			<textarea className="crux-code-input" aria-label={`${LANGS[lang]} code`} spellCheck={false} rows={8} value={code} placeholder={PLACEHOLDER[lang]}
				onChange={(e) => setCode(e.target.value)}
				onKeyDown={(e) => { if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const t = e.currentTarget, s = t.selectionStart; t.setRangeText(lang === "sql" ? "  " : "    ", s, t.selectionEnd, "end"); setCode(t.value); } if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(); } }} />
			{lang !== "sql" && <label className="crux-room-field">Input <span className="crux-room-sub">(one line for each input())</span><textarea className="crux-code-input" rows={2} spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} /></label>}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" className="cursor-pointer" disabled={busy || !code.trim()} onClick={() => void run()}>{busy ? "Running…" : "Run"}</Button>
				<Button size="sm" variant="outline" className="cursor-pointer" disabled={!code.trim()} onClick={ask}>Ask the tutor</Button>
				<span className="crux-room-sub self-center">Ctrl+Enter runs</span>
			</div>
			{res && (
				<div className="grid gap-2" aria-live="polite">
					{res.stopped && <p className="crux-room-error">Stopped: it ran for more than 3 seconds. Check for a loop that never ends.</p>}
					{res.blocked && <p className="crux-room-notice">This runs plain Python, without {res.blocked}.</p>}
					{lang === "sql" && !res.error && !res.stopped && (res.results?.length ? res.results.map((r, i) => (
						<div key={i} className="crux-sql-wrap"><table className="crux-sql"><thead><tr>{r.columns.map((c, j) => <th key={j}>{c}</th>)}</tr></thead><tbody>{r.rows.map((row, j) => <tr key={j}>{row.map((v, k) => <td key={k}>{v === null ? "NULL" : String(v)}</td>)}</tr>)}</tbody></table></div>
					)) : <p className="crux-room-sub">Done. {res.changes ? `${res.changes} rows changed.` : "No rows returned."}</p>)}
					{lang !== "sql" && !res.stopped && !res.blocked && (res.out || !res.error) && <pre className="crux-board-code"><code>{res.out || "(no output)"}</code></pre>}
					{res.error && <p className="crux-room-error">{res.error.type}{res.error.line ? ` on line ${res.error.line}` : ""}: {res.error.message}</p>}
				</div>
			)}
			{said && <p className="crux-room-sub" role="status">{said}</p>}
		</aside>
	);
}

/** The Code chip in a session's top bar, beside Files. */
export function CodeChip() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Hint label="Run Python, SQL or JavaScript here" side="bottom">
				<button type="button" data-testid="code-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}
					className="lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-border hover:text-foreground">
					<CodeIcon className="size-3.5 text-primary" aria-hidden />
					<span className="sr-only xl:not-sr-only">Code</span>
				</button>
			</Hint>
			{open && <CodePanel onClose={() => setOpen(false)} />}
		</>
	);
}

export { languageOf };
