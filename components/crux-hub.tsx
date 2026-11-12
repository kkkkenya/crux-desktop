"use client";

/**
 * Hub files (Crux desktop): the Study Hub's notes and past papers for a unit,
 * downloaded once to Documents/Crux/Hub and attached to a session by path.
 *
 * Everything that touches the Crux account runs in the Electron main process
 * (electron/crux-hub.cjs) behind window.lh.crux. This component only shows
 * names, lists and local paths, and never sees the Crux session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, FileTextIcon, FolderOpenIcon, LibraryIcon, PlusIcon, XIcon } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { INSERT_FILE_PATHS_EVENT } from "@/components/path-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CruxReply<T> = { ok: true; value: T } | { ok: false; code: string; error: string; resetsAt?: string | null };
export interface CruxStatus { signedIn: boolean; name?: string; tier?: string; avatar?: string; problem?: string; offline?: boolean }
export interface CruxUnit { code: string; title: string }
export interface CruxFile { id: string; name: string; paper: boolean; pages: number | null; path: string | null }
/** The preload bridge (electron/preload.cjs → electron/crux-hub.cjs). Desktop only. */
export interface CruxBridge {
	status: () => Promise<CruxReply<CruxStatus>>;
	login: () => Promise<CruxReply<CruxStatus>>;
	logout: () => Promise<CruxReply<CruxStatus>>;
	units: () => Promise<CruxReply<{ mine: CruxUnit[]; all: CruxUnit[] }>>;
	files: (unit: string) => Promise<CruxReply<{ note: string | null; files: CruxFile[] }>>;
	download: (unit: string, id: string, name: string) => Promise<CruxReply<{ path: string; left: number | null; cached: boolean }>>;
	reveal: (path: string) => Promise<CruxReply<boolean>>;
	// Study setup, the notes panel and "open in book" (components/crux-study.tsx).
	study: () => Promise<CruxReply<CruxStudy>>;
	catalog: (course?: string, year?: number) => Promise<CruxReply<CruxCatalog>>;
	saveSetup: (setup: CruxSetupChoice) => Promise<CruxReply<CruxStudy>>;
	skipSetup: () => Promise<CruxReply<boolean>>;
	addNote: (note: { text: string; unit: string | null; from?: string }) => Promise<CruxReply<CruxNote>>;
	removeNote: (id: string) => Promise<CruxReply<boolean>>;
	learn: (unit: string, topicId: string) => Promise<CruxReply<CruxLearn>>;
	makeGuide: (unit: string, topicId: string, fresh?: boolean) => Promise<CruxReply<CruxGuide>>;
	openAt: (unit: string, id: string, name: string, page: number | null) => Promise<CruxReply<{ path: string; left: number | null }>>;
}
export interface CruxNote { id: string; text: string; unit: string | null; from: string; at: string }
export interface CruxStudy {
	units: (CruxUnit & { catDate: string | null })[];
	topics: { id: string; unit: string; name: string }[];
	notes: CruxNote[];
	cohort: { course: string; year: number; sem: number } | null;
	setupSkipped: boolean;
}
export interface CruxCatalog { courses: { code: string; name: string }[]; course: string; year: number | null; core: CruxUnit[]; shared: CruxUnit[] }
export interface CruxSetupChoice { cohort: { course: string; year: number; sem: number }; units: CruxUnit[]; dates: Record<string, string> }
export interface CruxRef { fileId: string; name: string; pages: number[] | null; snippet: string }
export interface CruxGuide {
	overview: string;
	outline: { name: string; expect: string; skip: string; formulas: string[]; read: { book: string; where: string; focus: string; page: number | null }[] }[];
	exam: string;
	plan: string[];
	checklist: string[];
}
export interface CruxLearn { guide: CruxGuide | null; read: CruxRef[]; examples: CruxRef[]; books: { id: string; name: string }[] }

const LAST_UNIT = "crux:hub-unit";
const TIER_LABEL: Record<string, string> = { owner: "Owner", premium: "Premium", basic: "Basic", trial: "Trial" };

/** When today's limit resets, in Nairobi time (the Hub's day). */
function resetText(iso: string | null | undefined): string {
	if (!iso) return "";
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	return ` They reset at ${at.toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit" })} Nairobi time.`;
}

/** The units whose code or title contains every word typed, best eight. */
export function matchUnits(all: readonly CruxUnit[], query: string): CruxUnit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	return all
		.filter((u) => { const hay = `${u.code} ${u.title}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
		.slice(0, 8);
}

function FileRow({ file, busy, onDownload, onAdd, onReveal }: {
	file: CruxFile;
	busy: boolean;
	onDownload: () => void;
	onAdd: () => void;
	onReveal: () => void;
}) {
	return (
		<li className="flex items-center gap-3 border-t border-border/60 py-2 first:border-t-0" data-testid="hub-file">
			<FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm" title={file.name}>{file.name}</span>
				{file.pages !== null && <span className="block text-xs text-muted-foreground">{file.pages} {file.pages === 1 ? "page" : "pages"}</span>}
			</span>
			{file.path ? (
				<>
					<Button type="button" size="icon-xs" variant="ghost" className="cursor-pointer" aria-label={`Show ${file.name} in its folder`} title="Show in folder" onClick={onReveal}>
						<FolderOpenIcon />
					</Button>
					<Button type="button" size="xs" className="cursor-pointer" onClick={onAdd} data-testid="hub-add">
						<PlusIcon />Add to session
					</Button>
				</>
			) : (
				<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" disabled={busy} aria-busy={busy} onClick={onDownload} data-testid="hub-download">
					{busy ? <BrailleSpinner label={`Downloading ${file.name}`} /> : <DownloadIcon />}Download
				</Button>
			)}
		</li>
	);
}

export function HubDialog({ bridge, onClose }: { bridge: CruxBridge | undefined; onClose: () => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [status, setStatus] = useState<CruxStatus | null>(null);
	const [units, setUnits] = useState<{ mine: CruxUnit[]; all: CruxUnit[] } | null>(null);
	const [unit, setUnit] = useState<string | null>(null);
	const [files, setFiles] = useState<CruxFile[] | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState<string | null>(null); // "sign-in" or "files"
	const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set()); // file ids, across unit switches
	const [message, setMessage] = useState<string>("");

	useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog && !dialog.open) dialog.showModal();
	}, []);

	const fail = useCallback((reply: { code: string; error: string; resetsAt?: string | null }) => {
		if (reply.code === "signed-out" || reply.code === "no-access") { setStatus({ signedIn: false, problem: reply.code === "no-access" ? reply.error : undefined }); setUnits(null); setFiles(null); }
		setMessage(`${reply.error}${reply.code === "download-limit" ? resetText(reply.resetsAt) : ""}`);
	}, []);

	const loadUnits = useCallback(async () => {
		if (!bridge) return;
		const reply = await bridge.units();
		if (!reply.ok) { fail(reply); return; }
		setUnits(reply.value);
		let last: string | null = null;
		try { last = localStorage.getItem(LAST_UNIT); } catch { /* storage blocked: start with no unit */ }
		const known = [...reply.value.mine, ...reply.value.all];
		setUnit((current) => current ?? (last && known.some((u) => u.code === last) ? last : reply.value.mine[0]?.code ?? null));
	}, [bridge, fail]);

	useEffect(() => {
		if (!bridge) return;
		let cancelled = false;
		void bridge.status().then((reply) => {
			if (cancelled) return;
			if (!reply.ok) { setStatus({ signedIn: false }); setMessage(reply.error); return; }
			setStatus(reply.value);
			if (reply.value.signedIn) void loadUnits();
		});
		return () => { cancelled = true; };
	}, [bridge, loadUnits]);

	useEffect(() => {
		if (!bridge || !unit || !status?.signedIn) return;
		let cancelled = false;
		setFiles(null); setNote(null); setBusy("files"); setMessage("");
		try { localStorage.setItem(LAST_UNIT, unit); } catch { /* storage blocked */ }
		void bridge.files(unit).then((reply) => {
			if (cancelled) return;
			setBusy(null);
			if (!reply.ok) { setFiles([]); fail(reply); return; }
			setFiles(reply.value.files); setNote(reply.value.note);
		});
		return () => { cancelled = true; };
	}, [bridge, unit, status?.signedIn, fail]);

	const signIn = async () => {
		if (!bridge) return;
		setBusy("sign-in"); setMessage("");
		const reply = await bridge.login();
		setBusy(null);
		if (!reply.ok) { setMessage(reply.error); return; }
		setStatus(reply.value);
		if (reply.value.signedIn) void loadUnits();
		else setMessage(reply.value.problem ?? "Sign-in was not finished. Try again when you're ready.");
	};

	const signOut = async () => {
		if (!bridge) return;
		await bridge.logout();
		setStatus({ signedIn: false }); setUnits(null); setUnit(null); setFiles(null); setMessage("");
	};

	const download = async (file: CruxFile) => {
		if (!bridge || !unit) return;
		if (downloading.has(file.id)) return;
		setDownloading((current) => new Set(current).add(file.id)); setMessage("");
		const reply = await bridge.download(unit, file.id, file.name);
		setDownloading((current) => { const next = new Set(current); next.delete(file.id); return next; });
		if (!reply.ok) { fail(reply); return; }
		setFiles((current) => current?.map((f) => (f.id === file.id ? { ...f, path: reply.value.path } : f)) ?? null);
		if (typeof reply.value.left === "number") setMessage(`Downloaded. ${reply.value.left} ${reply.value.left === 1 ? "download" : "downloads"} left today.`);
	};

	const addToSession = (file: CruxFile) => {
		if (!file.path) return;
		const editor = document.querySelector<HTMLElement>("[data-file-path-default]");
		if (!editor) { setMessage("Open a session or the home screen first, then add the file."); return; }
		editor.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: [file.path] }));
		onClose();
		editor.focus();
	};

	const matches = useMemo(() => matchUnits(units?.all ?? [], query), [units, query]);
	const unitTitle = useMemo(() => [...(units?.mine ?? []), ...(units?.all ?? [])].find((u) => u.code === unit)?.title ?? "", [units, unit]);
	const papers = files?.filter((f) => f.paper) ?? [];
	const notes = files?.filter((f) => !f.paper) ?? [];

	return (
		<dialog
			ref={dialogRef}
			onClose={onClose}
			onMouseDown={(event) => {
				const box = dialogRef.current?.getBoundingClientRect();
				if (box && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialogRef.current?.close();
			}}
			aria-labelledby="hub-title"
			data-testid="hub-dialog"
			className="lh-no-drag m-auto max-h-[82vh] w-[min(680px,92vw)] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60"
		>
			<div className="flex max-h-[82vh] flex-col">
				<header className="flex items-start gap-3 border-b border-border/60 px-6 pb-4 pt-5">
					<div className="min-w-0 flex-1">
						<h2 id="hub-title" className="font-title text-2xl tracking-tight">Hub files</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							{status?.signedIn
								? <>Signed in as {status.name || "you"}{status.tier && TIER_LABEL[status.tier] ? ` · ${TIER_LABEL[status.tier]}` : ""}. <button type="button" className="cursor-pointer underline underline-offset-2 hover:text-foreground" onClick={() => void signOut()} data-testid="hub-sign-out">Sign out</button></>
								: "Notes and past papers from the Study Hub, for your units."}
						</p>
					</div>
					<Button type="button" size="icon-sm" variant="ghost" className="cursor-pointer" aria-label="Close" onClick={() => dialogRef.current?.close()}>
						<XIcon className="size-4" />
					</Button>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{!bridge ? (
						<p className="text-sm text-muted-foreground" data-testid="hub-browser-note">Hub files open in the Crux desktop app. This page is running in a browser, which can't download them for a session.</p>
					) : status === null ? (
						<p className="text-sm text-muted-foreground"><BrailleSpinner label="Checking your Crux account" /> Checking your Crux account…</p>
					) : !status.signedIn ? (
						<div className="flex flex-col items-start gap-3">
							<p className="text-sm text-muted-foreground">Sign in with the Discord account you use in the Study Hub. Crux then lists the notes and past papers for your units, and you can add any of them to a session.</p>
							<Button type="button" className="cursor-pointer disabled:cursor-not-allowed" disabled={busy === "sign-in"} aria-busy={busy === "sign-in"} onClick={() => void signIn()} data-testid="hub-sign-in">
								{busy === "sign-in" && <BrailleSpinner label="Waiting for sign-in" />}
								Sign in with Discord
							</Button>
						</div>
					) : (
						<div className="flex flex-col gap-5">
							<section aria-label="Unit">
								{(units?.mine.length ?? 0) > 0 && (
									<div className="mb-3 flex flex-wrap gap-1.5" data-testid="hub-my-units">
										{units!.mine.map((u) => (
											<button
												key={u.code}
												type="button"
												title={u.title}
												aria-pressed={unit === u.code}
												onClick={() => setUnit(u.code)}
												className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors",
													unit === u.code ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}
											>
												{u.code}
											</button>
										))}
									</div>
								)}
								<Input
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder={units === null ? "Loading units…" : "Find a unit by code or name, e.g. EMM 302"}
									aria-label="Find a unit"
									disabled={units === null}
									data-testid="hub-unit-search"
								/>
								{matches.length > 0 && (
									<ul className="mt-2 flex flex-col">
										{matches.map((u) => (
											<li key={u.code}>
												<button
													type="button"
													onClick={() => { setUnit(u.code); setQuery(""); }}
													className="flex w-full cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
												>
													<span className="shrink-0 font-medium">{u.code}</span>
													<span className="truncate text-muted-foreground">{u.title}</span>
												</button>
											</li>
										))}
									</ul>
								)}
							</section>

							{unit && (
								<section aria-label={`Files for ${unit}`}>
									<h3 className="text-sm font-medium">{unit}{unitTitle ? <span className="font-normal text-muted-foreground"> · {unitTitle}</span> : null}</h3>
									{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
									{files === null ? (
										<p className="mt-3 text-sm text-muted-foreground"><BrailleSpinner label="Loading files" /> Loading files…</p>
									) : files.length === 0 ? (
										<p className="mt-3 text-sm text-muted-foreground" data-testid="hub-empty">The Hub has no files for this unit yet.</p>
									) : (
										<>
											{[["Past papers", papers], ["Notes and slides", notes]].map(([label, group]) => (group as CruxFile[]).length > 0 && (
												<div key={label as string} className="mt-4">
													<p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">{label as string}</p>
													<ul>
														{(group as CruxFile[]).map((file) => (
															<FileRow
																key={file.id}
																file={file}
																busy={downloading.has(file.id)}
																onDownload={() => void download(file)}
																onAdd={() => addToSession(file)}
																onReveal={() => { if (file.path) void bridge.reveal(file.path).then((reply) => { if (!reply.ok) setMessage(reply.error); }); }}
															/>
														))}
													</ul>
												</div>
											))}
										</>
									)}
								</section>
							)}
						</div>
					)}
				</div>

				{message && <p role="status" className="border-t border-border/60 px-6 py-3 text-xs text-muted-foreground" data-testid="hub-message">{message}</p>}
			</div>
		</dialog>
	);
}

/** The sidebar row that opens Hub files. Same quiet row language as Settings. */
export function HubEntry() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				data-testid="hub-entry"
				className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				<LibraryIcon className="size-3" />
				Hub files
			</button>
			{open && <HubDialog bridge={typeof window === "undefined" ? undefined : window.lh?.crux} onClose={() => setOpen(false)} />}
		</>
	);
}
