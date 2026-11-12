"use client";

/**
 * Crux study pieces for the desktop app (2026-11-12):
 *
 * - CruxNotesPanel: the notes column beside a session, like Crux web's notes bar.
 *   "Notes" holds clips pinned from the lesson and notes you write; they live in
 *   your Crux account (the same notes Crux web shows), per unit or for all units.
 *   "Study guide" is Crux's guide for a topic: what to know, the formulas, and
 *   where in your books to read, each with "Open at page N".
 * - OpenAtButton: opens a Hub file inside Crux at a page (downloaded once).
 * - CruxSetup: the first run after sign-in: course and year, units, CAT dates.
 *   "I'm not an engineering student" skips it for good on this computer.
 *
 * Everything that talks to Crux goes through window.lh.crux (electron/crux-hub.cjs).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenIcon, MedalIcon, NotebookPenIcon, PinIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import type { CruxBridge, CruxCatalog, CruxContributors, CruxGuide, CruxLearn, CruxNote, CruxRef, CruxStudy, CruxUnit, CruxUploads } from "@/components/crux-hub";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const cruxBridge = (): CruxBridge | undefined => (typeof window === "undefined" ? undefined : window.lh?.crux);

const OPEN_KEY = "crux:notes-open";
const unitKey = (chatId: string) => `crux:notes-unit:${chatId}`;
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* a convenience */ } };

/** Whether the notes panel is open, remembered across sessions. */
export function useNotesOpen(): [boolean, (open: boolean) => void] {
	const [open, setOpen] = useState(false);
	useEffect(() => { setOpen(read(OPEN_KEY) === "1"); }, []);
	const set = useCallback((next: boolean) => { setOpen(next); write(OPEN_KEY, next ? "1" : "0"); }, []);
	return [open, set];
}

/** The notes the panel shows for a unit: that unit's, then the ones for all units, newest first. */
export function notesFor(notes: readonly CruxNote[], unit: string | null): CruxNote[] {
	return notes
		.filter((n) => n.unit === null || n.unit === unit)
		.sort((a, b) => Number(a.unit === null) - Number(b.unit === null) || b.at.localeCompare(a.at));
}

/** "p. 12" or "pp. 12–14" for a page range from Crux. */
export function pagesText(pages: readonly number[] | null): string {
	if (!pages?.length) return "";
	return pages.length > 1 && pages[1] !== pages[0] ? `pp. ${pages[0]}–${pages[1]}` : `p. ${pages[0]}`;
}

export function OpenAtButton({ unit, fileId, name, page, label }: { unit: string; fileId: string; name: string; page: number | null; label?: string }) {
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");
	const bridge = cruxBridge();
	if (!bridge || !/^\d+$/.test(fileId) || !name) return null;
	const open = async () => {
		setBusy(true); setProblem("");
		const reply = await bridge.openAt(unit, fileId, name, page).catch(() => null);
		setBusy(false);
		if (!reply) setProblem("The file could not be opened.");
		else if (!reply.ok) setProblem(reply.error);
	};
	return (
		<span className="inline-flex flex-wrap items-center gap-1">
			<button type="button" onClick={() => void open()} disabled={busy} data-testid="open-at"
				className="inline-flex cursor-pointer items-center gap-1 rounded px-1 text-xs text-primary underline-offset-2 hover:underline disabled:cursor-wait disabled:opacity-60">
				{busy ? <BrailleSpinner label={`Opening ${name}`} /> : <BookOpenIcon className="size-3" aria-hidden />}
				{label ?? (page ? `Open at page ${page}` : "Open the file")}
			</button>
			{problem && <span role="alert" className="text-xs text-destructive">{problem}</span>}
		</span>
	);
}

// ---------------------------------------------------------------- notes panel

/** "Pin" beside text selected in the lesson. Only outside the panel and outside typing boxes. */
function PinSelection({ onPin }: { onPin: (text: string) => void }) {
	const [at, setAt] = useState<{ x: number; y: number; text: string } | null>(null);
	useEffect(() => {
		const look = () => {
			const sel = window.getSelection();
			const text = sel?.toString().trim() ?? "";
			const node = sel?.anchorNode ?? null;
			const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
			if (!sel || sel.rangeCount === 0 || text.length < 2 || !el || el.closest("[data-testid=crux-notes], input, textarea, [contenteditable=true], dialog")) { setAt(null); return; }
			const box = sel.getRangeAt(0).getBoundingClientRect();
			setAt({ x: Math.min(box.right, window.innerWidth - 80), y: Math.max(box.top - 36, 8), text: text.slice(0, 2000) });
		};
		const up = () => window.setTimeout(look, 0);
		const clear = () => { if (!window.getSelection()?.toString()) setAt(null); };
		document.addEventListener("mouseup", up);
		document.addEventListener("keyup", up);
		document.addEventListener("selectionchange", clear);
		return () => { document.removeEventListener("mouseup", up); document.removeEventListener("keyup", up); document.removeEventListener("selectionchange", clear); };
	}, []);
	if (!at) return null;
	return (
		<button type="button" data-testid="pin-selection"
			onMouseDown={(e) => e.preventDefault()}
			onClick={() => { onPin(at.text); setAt(null); window.getSelection()?.removeAllRanges(); }}
			style={{ left: at.x, top: at.y }}
			className="lh-no-drag fixed z-50 flex cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs shadow-lg hover:bg-accent">
			<PinIcon className="size-3" aria-hidden />Pin to notes
		</button>
	);
}

function NoteItem({ note, onRemove }: { note: CruxNote; onRemove: () => void }) {
	return (
		<li className="group rounded-lg border border-border/70 bg-background/40 p-2.5" data-testid="crux-note">
			<MessageResponse className="text-sm">{note.text}</MessageResponse>
			<div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
				<span className="min-w-0 flex-1 truncate">{[note.unit ?? "All units", note.from].filter(Boolean).join(" · ")}</span>
				<button type="button" aria-label="Remove this note" title="Remove" onClick={onRemove}
					className="cursor-pointer rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100 group-hover:opacity-100">
					<Trash2Icon className="size-3.5" />
				</button>
			</div>
		</li>
	);
}

function RefItem({ unit, r }: { unit: string; r: CruxRef }) {
	return (
		<li className="text-sm">
			<span className="font-medium">{r.name.replace(/\.[a-z0-9]+$/i, "")}</span>
			{r.pages && <span className="text-muted-foreground"> · {pagesText(r.pages)}</span>}
			{r.snippet && <span className="block text-xs text-muted-foreground">{r.snippet}</span>}
			<OpenAtButton unit={unit} fileId={r.fileId} name={r.name} page={r.pages?.[0] ?? null} />
		</li>
	);
}

function GuideView({ unit, guide, books }: { unit: string; guide: CruxGuide; books: CruxLearn["books"] }) {
	const fileOf = (name: string) => books.find((b) => b.name === name);
	return (
		<div className="space-y-3 text-sm" data-testid="crux-guide">
			{guide.overview && <MessageResponse>{guide.overview}</MessageResponse>}
			<ol className="space-y-2">
				{guide.outline.map((o) => (
					<li key={o.name}>
						<details open={guide.outline.length <= 3 || undefined} className="rounded-lg border border-border/60 p-2">
							<summary className="cursor-pointer font-medium">{o.name}</summary>
							<div className="mt-2 space-y-2">
								{o.expect && <MessageResponse>{`**You should be able to** ${o.expect}`}</MessageResponse>}
								{o.formulas.length > 0 && <MessageResponse>{o.formulas.map((f) => `- ${f}`).join("\n")}</MessageResponse>}
								{o.read.length > 0 && (
									<ul className="space-y-1.5">
										{o.read.map((r) => {
											const book = fileOf(r.book);
											return (
												<li key={r.book + r.where}>
													<b>{r.book.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ")}</b> · {r.where}
													{r.focus && <span className="text-muted-foreground">: {r.focus}</span>}{" "}
													{book && <OpenAtButton unit={unit} fileId={book.id} name={book.name} page={r.page} />}
												</li>
											);
										})}
									</ul>
								)}
								{o.skip && <p className="text-xs text-muted-foreground"><b>Skip</b> {o.skip}</p>}
							</div>
						</details>
					</li>
				))}
			</ol>
			{guide.exam && <MessageResponse>{`**How it's examined:** ${guide.exam}`}</MessageResponse>}
			{guide.plan.length > 0 && <MessageResponse>{`**Study it in this order**\n\n${guide.plan.map((x, i) => `${i + 1}. ${x}`).join("\n")}`}</MessageResponse>}
			{guide.checklist.length > 0 && (
				<div>
					<p className="font-medium">Before the exam, I can…</p>
					<ul className="mt-1 space-y-1">
						{guide.checklist.map((x) => (
							<li key={x}><label className="flex cursor-pointer items-start gap-2"><input type="checkbox" className="mt-1" /><span>{x.replace(/^I can\s*/i, "")}</span></label></li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function StudyGuideTab({ bridge, unit, topics }: { bridge: CruxBridge; unit: string; topics: CruxStudy["topics"] }) {
	const mine = useMemo(() => topics.filter((t) => t.unit === unit), [topics, unit]);
	const [topicId, setTopicId] = useState("");
	const [path, setPath] = useState<CruxLearn | null>(null);
	const [busy, setBusy] = useState(false);
	const [making, setMaking] = useState(false);
	const [problem, setProblem] = useState("");
	useEffect(() => { if (!mine.some((t) => t.id === topicId)) setTopicId(mine[0]?.id ?? ""); }, [mine, topicId]);
	useEffect(() => {
		setPath(null); setProblem("");
		if (!unit || !topicId) return;
		let live = true;
		setBusy(true);
		void bridge.learn(unit, topicId).then((reply) => {
			if (!live) return;
			setBusy(false);
			if (reply.ok) setPath(reply.value); else setProblem(reply.error);
		}).catch(() => { if (live) { setBusy(false); setProblem("Crux could not be reached."); } });
		return () => { live = false; };
	}, [bridge, unit, topicId]);
	const make = async (fresh: boolean) => {
		setMaking(true); setProblem("");
		const reply = await bridge.makeGuide(unit, topicId, fresh).catch(() => null);
		setMaking(false);
		if (!reply) setProblem("Crux could not be reached.");
		else if (!reply.ok) setProblem(reply.error);
		else setPath((p) => (p ? { ...p, guide: reply.value } : p));
	};
	if (!mine.length) return <p className="text-sm text-muted-foreground">{unit} has no topics on Crux yet. Add them on Crux web (your unit, then Topics), then come back.</p>;
	return (
		<div className="space-y-3">
			<label className="block text-xs text-muted-foreground">Topic
				<select value={topicId} onChange={(e) => setTopicId(e.target.value)} data-testid="guide-topic"
					className="mt-1 block w-full cursor-pointer rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
					{mine.map((t, n) => <option key={t.id} value={t.id}>{n + 1}. {t.name}</option>)}
				</select>
			</label>
			{problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
			{busy && <p className="text-sm text-muted-foreground"><BrailleSpinner label="Loading" /> Loading…</p>}
			{path && (
				<>
					{making ? <p className="text-sm text-muted-foreground"><BrailleSpinner label="Making the guide" /> Making the study guide. This takes up to a minute.</p>
						: path.guide ? (
							<>
								<GuideView unit={unit} guide={path.guide} books={path.books} />
								<p className="text-xs text-muted-foreground">Made by Crux from your course outline, past papers and books. <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => void make(true)}>Make it again</button></p>
							</>
						) : (
							<div className="space-y-2">
								<p className="text-sm text-muted-foreground">What the course expects on this topic, the formulas, and where in your books to read (and what to skip). Uses one AI action on your plan.</p>
								<Button type="button" size="sm" className="cursor-pointer" onClick={() => void make(false)} data-testid="make-guide">Make a study guide</Button>
							</div>
						)}
					{path.read.length > 0 && (
						<div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Read</p><ol className="space-y-2">{path.read.map((r, i) => <RefItem key={`${r.fileId}-${i}`} unit={unit} r={r} />)}</ol></div>
					)}
					{path.examples.length > 0 && (
						<div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Worked examples</p><ol className="space-y-2">{path.examples.map((r, i) => <RefItem key={`${r.fileId}-e${i}`} unit={unit} r={r} />)}</ol></div>
					)}
				</>
			)}
		</div>
	);
}

export function CruxNotesPanel({ chatId, title, onClose }: { chatId: string; title: string; onClose: () => void }) {
	const bridge = cruxBridge();
	const [study, setStudy] = useState<CruxStudy | null>(null);
	const [problem, setProblem] = useState("");
	const [tab, setTab] = useState<"notes" | "guide">("notes");
	const [unit, setUnitState] = useState<string>("");
	const [draft, setDraft] = useState("");
	const [forAll, setForAll] = useState(false);
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		if (!bridge) return;
		const reply = await bridge.study().catch(() => null);
		if (!reply) { setProblem("Crux could not be reached."); return; }
		if (!reply.ok) { setProblem(reply.error); return; }
		setProblem("");
		setStudy(reply.value);
	}, [bridge]);
	useEffect(() => { void load(); }, [load]);
	useEffect(() => {
		if (!study) return;
		const saved = read(unitKey(chatId));
		const codes = study.units.map((u) => u.code);
		setUnitState(saved && codes.includes(saved) ? saved : codes[0] ?? "");
	}, [study, chatId]);
	const setUnit = (code: string) => { setUnitState(code); write(unitKey(chatId), code); };

	const add = async (text: string, from: string) => {
		if (!bridge || !text.trim()) return;
		setSaving(true); setProblem("");
		const reply = await bridge.addNote({ text, unit: forAll || !unit ? null : unit, from }).catch(() => null);
		setSaving(false);
		if (!reply) { setProblem("The note was not saved. Check your connection."); return; }
		if (!reply.ok) { setProblem(reply.error); return; }
		setStudy((s) => (s ? { ...s, notes: [reply.value, ...s.notes] } : s));
		setDraft("");
	};
	const remove = async (id: string) => {
		if (!bridge) return;
		const before = study;
		setStudy((s) => (s ? { ...s, notes: s.notes.filter((n) => n.id !== id) } : s));
		const reply = await bridge.removeNote(id).catch(() => null);
		if (!reply || !reply.ok) { setStudy(before); setProblem(reply && !reply.ok ? reply.error : "The note was not removed. Check your connection."); }
	};

	const shown = useMemo(() => notesFor(study?.notes ?? [], unit || null), [study, unit]);
	const units: CruxUnit[] = study?.units ?? [];

	return (
		<aside data-testid="crux-notes" aria-label="Notes"
			className="lh-no-drag flex h-dvh w-[340px] shrink-0 flex-col border-l border-border bg-card/80 backdrop-blur-md">
			<PinSelection onPin={(text) => void add(text, title.slice(0, 100))} />
			<header className="flex h-15 shrink-0 items-center gap-1 border-b border-border px-3">
				{(["notes", "guide"] as const).map((t) => (
					<button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
						className={cn("cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium uppercase tracking-wide transition-colors", tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
						{t === "notes" ? "Notes" : "Study guide"}
					</button>
				))}
				<div className="flex-1" />
				<button type="button" aria-label="Close notes" title="Close notes" onClick={onClose} className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
					<XIcon className="size-4" />
				</button>
			</header>
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
				{!bridge && <p className="text-sm text-muted-foreground">Notes need the Crux desktop app.</p>}
				{bridge && !study && !problem && <p className="text-sm text-muted-foreground"><BrailleSpinner label="Loading notes" /> Loading…</p>}
				{problem && <p role="alert" className="text-sm text-destructive">{problem} <button type="button" className="cursor-pointer underline" onClick={() => void load()}>Try again</button></p>}
				{study && (
					units.length > 0 ? (
						<label className="block text-xs text-muted-foreground">Unit
							<select value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="notes-unit"
								className="mt-1 block w-full cursor-pointer rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
								{units.map((u) => <option key={u.code} value={u.code}>{u.code}{u.title ? ` · ${u.title}` : ""}</option>)}
							</select>
						</label>
					) : <p className="text-xs text-muted-foreground">No units picked on Crux yet, so notes here are for all units.</p>
				)}
				{study && tab === "notes" && (
					<>
						<form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void add(draft, title.slice(0, 100)); }}>
							<textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={2000} placeholder="Write a note. Select text in the lesson to pin it."
								onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(draft, title.slice(0, 100)); } }}
								data-testid="note-draft"
								className="block w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-muted-foreground/60" />
							<div className="flex items-center gap-2">
								{unit && <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={forAll} onChange={(e) => setForAll(e.target.checked)} />All units</label>}
								<div className="flex-1" />
								<Button type="submit" size="xs" className="cursor-pointer" disabled={saving || !draft.trim()} data-testid="note-add">
									{saving ? <BrailleSpinner label="Saving" /> : <NotebookPenIcon />}Add note
								</Button>
							</div>
						</form>
						{shown.length ? (
							<ul className="space-y-2">{shown.map((n) => <NoteItem key={n.id} note={n} onRemove={() => void remove(n.id)} />)}</ul>
						) : <p className="text-sm text-muted-foreground">No notes yet. They show on Crux web too.</p>}
					</>
				)}
				{study && bridge && tab === "guide" && (
					unit ? <StudyGuideTab bridge={bridge} unit={unit} topics={study.topics} />
						: <p className="text-sm text-muted-foreground">Pick your units first (your account, then Set up my units) to get study guides.</p>
				)}
			</div>
		</aside>
	);
}

// ---------------------------------------------------------------- first-run setup

const YEARS = [1, 2, 3, 4, 5];

/** Shows the setup once after sign-in when the student has no units on Crux and hasn't skipped it. */
export function CruxSetupGate({ children }: { children: React.ReactNode }) {
	const [need, setNeed] = useState<CruxStudy["cohort"] | undefined | false>(undefined);
	useEffect(() => {
		const bridge = cruxBridge();
		if (!bridge) { setNeed(false); return; }
		let live = true;
		void bridge.study().then((reply) => {
			if (!live) return;
			// Offline or Crux down: never block the app on the setup.
			if (!reply.ok || reply.value.setupSkipped || reply.value.units.length > 0) setNeed(false);
			else setNeed(reply.value.cohort);
		}).catch(() => { if (live) setNeed(false); });
		const again = () => setNeed(null);
		window.addEventListener("crux:setup", again);
		return () => { live = false; window.removeEventListener("crux:setup", again); };
	}, []);
	if (need === undefined || need === false) return <>{children}</>;
	return <CruxSetup cohort={need} onDone={() => setNeed(false)} />;
}

/** Opens the setup again (from the account menu). */
export const openCruxSetup = () => window.dispatchEvent(new Event("crux:setup"));

export function CruxSetup({ cohort: start, onDone }: { cohort: CruxStudy["cohort"]; onDone: () => void }) {
	const bridge = cruxBridge();
	const [step, setStep] = useState(1);
	const [cohort, setCohort] = useState(start ?? { course: "EMM", year: 1, sem: 1 });
	const [cat, setCat] = useState<CruxCatalog | null>(null);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [dates, setDates] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");

	useEffect(() => {
		if (!bridge) return;
		let live = true;
		void bridge.catalog(cohort.course, cohort.year).then((reply) => {
			if (!live) return;
			if (!reply.ok) { setProblem(reply.error); return; }
			setCat(reply.value);
			setPicked(new Set(reply.value.core.map((u) => u.code)));
		}).catch(() => { if (live) setProblem("Crux could not be reached."); });
		return () => { live = false; };
	}, [bridge, cohort.course, cohort.year]);

	const all = [...(cat?.core ?? []), ...(cat?.shared ?? [])];
	const chosen = all.filter((u) => picked.has(u.code));
	const skip = async () => { await bridge?.skipSetup().catch(() => null); onDone(); };
	const finish = async () => {
		if (!bridge) return;
		setBusy(true); setProblem("");
		const reply = await bridge.saveSetup({ cohort, units: chosen, dates }).catch(() => null);
		setBusy(false);
		if (!reply) { setProblem("Crux could not be reached. Check your connection."); return; }
		if (!reply.ok) { setProblem(reply.error); return; }
		onDone();
	};

	const select = "mt-1 block w-full cursor-pointer rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground";
	return (
		<main className="crux-gate flex h-dvh flex-col" data-testid="crux-setup">
			<div className="lh-drag h-15 shrink-0" />
			<div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 pb-16">
				<div className="w-full max-w-lg">
					<p className="text-xs uppercase tracking-wide text-muted-foreground">Step {step} of 3</p>
					<h1 className="mt-1 font-title text-3xl tracking-tight">{step === 1 ? "Your course" : step === 2 ? "Your units" : "CAT dates"}</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						{step === 1 && "Crux uses this to show your units' Hub files and study guides."}
						{step === 2 && "The units you take this semester. You can change them later."}
						{step === 3 && "Optional. Lessons aim at these dates. Leave one empty if you don't know it yet."}
					</p>
					{problem && <p role="alert" className="mt-4 text-sm text-destructive">{problem}</p>}

					{step === 1 && (
						<div className="mt-6 space-y-4">
							<label className="block text-sm">Course
								<select className={select} value={cohort.course} onChange={(e) => setCohort({ ...cohort, course: e.target.value })} data-testid="setup-course">
									{(cat?.courses.length ? cat.courses : [{ code: cohort.course, name: cohort.course }]).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
								</select>
							</label>
							<div className="grid grid-cols-2 gap-3">
								<label className="block text-sm">Year
									<select className={select} value={cohort.year} onChange={(e) => setCohort({ ...cohort, year: Number(e.target.value) })}>
										{YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
									</select>
								</label>
								<label className="block text-sm">Semester
									<select className={select} value={cohort.sem} onChange={(e) => setCohort({ ...cohort, sem: Number(e.target.value) })}>
										<option value={1}>Semester 1</option><option value={2}>Semester 2</option>
									</select>
								</label>
							</div>
							<div className="flex items-center gap-3 pt-2">
								<Button type="button" className="cursor-pointer" onClick={() => setStep(2)} disabled={!cat} data-testid="setup-next">Continue</Button>
								<button type="button" className="cursor-pointer text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => void skip()} data-testid="setup-skip">
									I&apos;m not an engineering student, skip this
								</button>
							</div>
						</div>
					)}

					{step === 2 && (
						<div className="mt-6">
							<ul className="max-h-[50vh] space-y-1 overflow-y-auto rounded-lg border border-border p-2">
								{all.map((u) => (
									<li key={u.code}>
										<label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
											<input type="checkbox" className="mt-1" checked={picked.has(u.code)} onChange={(e) => {
												const next = new Set(picked);
												if (e.target.checked) next.add(u.code); else next.delete(u.code);
												setPicked(next);
											}} />
											<span><span className="block text-sm font-medium">{u.code}</span><span className="block text-xs text-muted-foreground">{u.title}</span></span>
										</label>
									</li>
								))}
								{!all.length && <li className="p-2 text-sm text-muted-foreground">No units found for this course and year.</li>}
							</ul>
							<div className="mt-4 flex gap-3">
								<Button type="button" variant="outline" className="cursor-pointer" onClick={() => setStep(1)}>Back</Button>
								<Button type="button" className="cursor-pointer" onClick={() => setStep(3)} disabled={!chosen.length}>Continue</Button>
							</div>
						</div>
					)}

					{step === 3 && (
						<div className="mt-6">
							<ul className="space-y-2">
								{chosen.map((u) => (
									<li key={u.code} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
										<span className="min-w-0 flex-1"><span className="block text-sm font-medium">{u.code}</span><span className="block truncate text-xs text-muted-foreground">{u.title}</span></span>
										<label className="flex cursor-pointer items-center gap-1.5 text-xs"><input type="checkbox" checked={dates[u.code] === "TBA"} onChange={(e) => setDates({ ...dates, [u.code]: e.target.checked ? "TBA" : "" })} />TBA</label>
										<input type="date" aria-label={`${u.code} CAT date`} disabled={dates[u.code] === "TBA"}
											value={dates[u.code] && dates[u.code] !== "TBA" ? dates[u.code] : ""}
											onChange={(e) => setDates({ ...dates, [u.code]: e.target.value })}
											className="rounded-md border border-border bg-background px-2 py-1 text-sm [color-scheme:dark]" />
									</li>
								))}
							</ul>
							<div className="mt-4 flex gap-3">
								<Button type="button" variant="outline" className="cursor-pointer" onClick={() => setStep(2)}>Back</Button>
								<Button type="button" className="cursor-pointer" onClick={() => void finish()} disabled={busy} data-testid="setup-finish">
									{busy && <BrailleSpinner label="Saving" />}{busy ? "Saving…" : "Start"}
								</Button>
							</div>
						</div>
					)}
				</div>
			</div>
		</main>
	);
}

// ---------------------------------------------------------------- share with the class

const STATUS_TEXT: Record<string, string> = {
	new: "Waiting for the hub PC", received: "Being posted", posted: "Posted · 1 credit", merged: "Joined with your other photos",
	duplicate: "The hub already had it · no credit", failed: "Couldn't be posted",
};
const nairobiDay = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00+03:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" }) : "");

/** What the student is told about the reward, from Crux's credit count. Pure, for tests. */
export function rewardText(c: CruxUploads["credits"]): string {
	if (c.earned) return `You've earned Premium until ${nairobiDay(c.until)} and a contributor medal. Thank you!`;
	const left = Math.max(0, c.goal - c.count);
	if (c.premium) return `Your files help the whole class. ${left} more for a contributor medal.`;
	return `${left} more file${left === 1 ? "" : "s"} the hub doesn't have, and you get Premium until ${nairobiDay(c.until)} and a contributor medal.`;
}

/** "Share with your class": the student's own file, posted to the unit on the Study Hub Discord with their consent. */
export function ShareWithClass({ bridge, unit, ownUnit, onShared }: { bridge: CruxBridge; unit: string; ownUnit: boolean; onShared?: () => void }) {
	const input = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<File | null>(null);
	const [consent, setConsent] = useState(false);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");
	const [info, setInfo] = useState<CruxUploads | null>(null);
	useEffect(() => {
		if (!ownUnit) return;
		let live = true;
		void bridge.uploads(unit).then((r) => { if (live && r.ok) setInfo(r.value); }).catch(() => {});
		return () => { live = false; };
	}, [bridge, unit, ownUnit]);
	const send = async () => {
		if (!file || !consent) return;
		setBusy(true); setProblem("");
		const bytes = new Uint8Array(await file.arrayBuffer());
		const reply = await bridge.share({ unit, name: file.name, bytes, consent }).catch(() => null);
		setBusy(false);
		if (!reply) { setProblem("The upload failed. Check your connection."); return; }
		if (!reply.ok) { setProblem(reply.error); return; }
		setInfo(reply.value); setFile(null); setConsent(false);
		onShared?.();
	};
	return (
		<section aria-label="Share with your class" className="rounded-lg border border-border/70 p-3" data-testid="hub-share">
			<h3 className="text-sm font-medium">Share with your class</h3>
			{!ownUnit ? (
				<p className="mt-1 text-xs text-muted-foreground">Add {unit} to your units first (your account, then Set up my units) to share files for it.</p>
			) : (
				<>
					<p className="mt-1 text-xs text-muted-foreground">Have notes, a CAT or a past paper the hub is missing? Share it and the whole class gets it.</p>
					{info && (
						<div className="mt-2">
							<div className="flex items-center gap-2 text-xs">
								<span className="tabular-nums"><b>{info.credits.count}</b> / {info.credits.goal}</span>
								<span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (100 * info.credits.count) / Math.max(1, info.credits.goal))}%` }} /></span>
							</div>
							<p className="mt-1 text-xs text-muted-foreground" data-testid="hub-reward">{rewardText(info.credits)}</p>
						</div>
					)}
					<input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.ppt,.pptx,.doc,.docx"
						onChange={(e) => { setFile(e.target.files?.[0] ?? null); setProblem(""); e.target.value = ""; }} />
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Button type="button" size="xs" variant="outline" className="cursor-pointer" onClick={() => input.current?.click()} data-testid="hub-share-pick">
							<UploadIcon />{file ? "Choose another file" : "Choose a file"}
						</Button>
						{file && <span className="min-w-0 truncate text-xs" title={file.name}>{file.name}</span>}
					</div>
					{file && (
						<>
							<label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
								<input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="hub-share-consent" />
								<span>I agree to share this file on the Study Hub Discord for {unit}, credited to me. It is mine to share (my notes, or a paper given to the class).</span>
							</label>
							<Button type="button" size="xs" className="mt-2 cursor-pointer disabled:cursor-not-allowed" disabled={!consent || busy} onClick={() => void send()} data-testid="hub-share-send">
								{busy && <BrailleSpinner label="Sharing" />}Share with {unit}
							</Button>
						</>
					)}
					{problem && <p role="alert" className="mt-2 text-xs text-destructive">{problem}</p>}
					{info && info.files.length > 0 && (
						<ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">
							{info.files.slice(0, 5).map((f) => <li key={f.name + f.at} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{f.name}</span><span>{STATUS_TEXT[f.status] ?? f.status}</span></li>)}
						</ul>
					)}
				</>
			)}
		</section>
	);
}

// ---------------------------------------------------------------- top contributors

/** The top contributors' pictures, a medal on those who reached the goal. Only that metric. */
export function TopContributors({ bridge }: { bridge: CruxBridge }) {
	const [board, setBoard] = useState<CruxContributors | null>(null);
	useEffect(() => {
		let live = true;
		void bridge.contributors().then((r) => { if (live && r.ok) setBoard(r.value); }).catch(() => {});
		return () => { live = false; };
	}, [bridge]);
	if (!board || board.top.length === 0) return null;
	return (
		<section aria-label="Top contributors" className="flex items-center gap-3" data-testid="hub-contributors">
			<span className="text-xs uppercase tracking-widest text-muted-foreground">Top contributors</span>
			<ul className="flex -space-x-1.5">
				{board.top.map((c, i) => (
					<li key={`${c.name}-${i}`} className="relative" title={`${c.name}: ${c.files} file${c.files === 1 ? "" : "s"}${c.medal ? " · contributor medal" : ""}`}>
						<span className={cn("flex size-8 items-center justify-center overflow-hidden rounded-full border-2 bg-muted text-xs font-medium", c.you ? "border-primary" : "border-card")}>
							{c.avatar ? <img src={c.avatar} alt={c.name} className="size-full object-cover" referrerPolicy="no-referrer" /> : c.name.slice(0, 1).toUpperCase()}
						</span>
						{c.medal && <MedalIcon className="absolute -bottom-1 -right-1 size-3.5 text-primary drop-shadow" aria-label="Contributor medal" />}
					</li>
				))}
			</ul>
		</section>
	);
}
