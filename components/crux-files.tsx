"use client";

/**
 * Files (Crux desktop, 2026-11-16): the chip in the session's top bar that opens a
 * unit's PDFs and marking schemes in a reader window beside the lesson, so the
 * student can refer to the paper, the notes or the solution while they work.
 *
 * Saved files come from Documents/Crux/Hub/<unit> (and its Solutions folder);
 * opening one costs nothing. Hub files not saved yet download once, then open.
 * Everything runs through window.lh.crux (electron/crux-hub.cjs).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenIcon, FileCheck2Icon, FileTextIcon, FilesIcon, XIcon } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { cn } from "@/lib/utils";
import { sortFiles } from "@/lib/file-list";
import { cruxBridge } from "@/components/crux-study";
import { openInCrux } from "@/components/crux-reader";
import type { CruxBridge, CruxFile, CruxLocalFile, CruxUnit } from "@/components/crux-hub";

const LAST_UNIT = "crux:hub-unit"; // shared with Hub files, so both open on the same unit

/** What the reader can show: saved PDFs and HTML pages, solutions first. Markdown packs are for the tutor. */
export function readable(files: readonly CruxLocalFile[]): { solutions: CruxLocalFile[]; saved: CruxLocalFile[] } {
	const shown = files.filter((f) => f.kind === "pdf" || f.kind === "html");
	// Natural order, so "Week 2" sits before "Week 10" (the saved list is one page; no sort control needed here).
	return { solutions: sortFiles(shown.filter((f) => f.solution), "name"), saved: sortFiles(shown.filter((f) => !f.solution), "name") };
}

/** Hub PDFs of the unit that are not on this computer yet. */
export function notSaved(files: readonly CruxFile[]): CruxFile[] {
	return files.filter((f) => !f.path && /\.pdf$/i.test(f.name));
}

export function FilesChip() {
	const [open, setOpen] = useState(false);
	const [bridge, setBridge] = useState<CruxBridge | undefined>(undefined);
	useEffect(() => { setBridge(cruxBridge()); }, []);
	if (!bridge?.local) return null;
	return (
		<>
			<Hint label="Open a paper, notes or marking scheme" side="bottom">
				<button
					type="button"
					data-testid="files-chip"
					aria-haspopup="dialog"
					onClick={(e) => { blurAfterPointerClick(e); setOpen(true); }}
					className="lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-border hover:text-foreground"
				>
					<FilesIcon className="size-3.5 text-primary" aria-hidden />
					{/* the icon alone on narrow windows, so the session title keeps its room */}
					<span className="sr-only xl:not-sr-only">Files</span>
				</button>
			</Hint>
			{open && <FilesDialog bridge={bridge} onClose={() => setOpen(false)} />}
		</>
	);
}

export function FilesDialog({ bridge, onClose }: { bridge: CruxBridge; onClose: () => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [units, setUnits] = useState<CruxUnit[] | null>(null);
	const [unit, setUnit] = useState<string | null>(null);
	const [local, setLocal] = useState<CruxLocalFile[] | null>(null);
	const [hub, setHub] = useState<CruxFile[] | null>(null);
	const [busy, setBusy] = useState<string | null>(null); // the path or hub id being opened
	const [message, setMessage] = useState("");
	const current = useRef<string | null>(null); // the unit on screen: answers for another unit are dropped

	useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog && !dialog.open) dialog.showModal();
	}, []);

	useEffect(() => {
		let cancelled = false;
		void bridge.units().then((reply) => {
			if (cancelled) return;
			if (!reply.ok) { setUnits([]); setMessage(reply.error); return; }
			setUnits(reply.value.mine);
			let last: string | null = null;
			try { last = localStorage.getItem(LAST_UNIT); } catch { /* storage blocked */ }
			const known = [...reply.value.mine, ...reply.value.all];
			setUnit(last && known.some((u) => u.code === last) ? last : reply.value.mine[0]?.code ?? null);
		});
		return () => { cancelled = true; };
	}, [bridge]);

	const load = useCallback(async (code: string) => {
		current.current = code;
		setLocal(null); setHub(null); setMessage("");
		const saved = await bridge.local!(code).catch(() => null);
		if (current.current !== code) return;
		setLocal(saved?.ok ? saved.value : []);
		if (saved && !saved.ok) setMessage(saved.error);
		// The hub list needs the internet; saved files open without it.
		const online = await bridge.files(code).catch(() => null);
		if (current.current !== code) return;
		setHub(online?.ok ? online.value.files : []);
	}, [bridge]);

	useEffect(() => {
		if (!unit) return;
		try { localStorage.setItem(LAST_UNIT, unit); } catch { /* storage blocked */ }
		void load(unit);
	}, [unit, load]);

	// Opens as a tab in Crux's own viewer (crux-reader.tsx); the dialog closes so the file is in view.
	const openSaved = async (file: CruxLocalFile) => {
		if (bridge.bytes) { openInCrux({ path: file.path, name: file.name }); dialogRef.current?.close(); return; }
		setBusy(file.path); setMessage("");
		const reply = await bridge.openLocal!(file.path, null).catch(() => null);
		setBusy(null);
		if (!reply) setMessage("The file could not be opened.");
		else if (!reply.ok) setMessage(reply.error);
	};

	const openHub = async (file: CruxFile) => {
		const code = current.current;
		if (!code) return;
		setBusy(file.id); setMessage("");
		if (bridge.bytes) {
			const saved = await bridge.download(code, file.id, file.name).catch(() => null);
			setBusy(null);
			if (!saved) { setMessage("The file could not be downloaded."); return; }
			if (!saved.ok) { setMessage(saved.error); return; }
			openInCrux({ path: saved.value.path, name: file.name });
			dialogRef.current?.close();
			return;
		}
		const reply = await bridge.openAt(code, file.id, file.name, null).catch(() => null);
		setBusy(null);
		if (!reply) setMessage("The file could not be opened.");
		else if (!reply.ok) setMessage(reply.error);
		else if (current.current === code) void load(code);
	};

	const { solutions, saved } = readable(local ?? []);
	const later = notSaved(hub ?? []);
	const row = (key: string, name: string, icon: React.ReactNode, onOpen: () => void, label: string, testid: string) => (
		<li key={key} className="flex items-center gap-3 border-t border-border/60 py-2 first:border-t-0" data-testid={testid}>
			{icon}
			<span className="min-w-0 flex-1 truncate text-sm" title={name}>{name}</span>
			<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-wait" disabled={busy !== null} aria-busy={busy === key} onClick={onOpen}>
				{busy === key ? <BrailleSpinner label={`Opening ${name}`} /> : <BookOpenIcon />}{label}
			</Button>
		</li>
	);

	return (
		<dialog
			ref={dialogRef}
			onClose={onClose}
			onMouseDown={(event) => {
				const box = dialogRef.current?.getBoundingClientRect();
				if (box && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialogRef.current?.close();
			}}
			aria-labelledby="files-title"
			data-testid="files-dialog"
			className="lh-no-drag m-auto max-h-[82vh] w-[min(620px,92vw)] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60"
		>
			<div className="flex max-h-[82vh] flex-col">
				<header className="flex items-start gap-3 border-b border-border/60 px-6 pb-4 pt-5">
					<div className="min-w-0 flex-1">
						<h2 id="files-title" className="font-title text-2xl tracking-tight">Files</h2>
						<p className="mt-1 text-xs text-muted-foreground">Opens inside Crux. Collapse it to keep the page small in your notes while you work.</p>
					</div>
					<Button type="button" size="icon-sm" variant="ghost" className="cursor-pointer" aria-label="Close" onClick={() => dialogRef.current?.close()}>
						<XIcon className="size-4" />
					</Button>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{units === null ? (
						<p className="text-sm text-muted-foreground"><BrailleSpinner label="Loading your units" /> Loading your units…</p>
					) : (
						<div className="flex flex-col gap-5">
							{units.length > 0 && (
								<div className="flex flex-wrap gap-1.5" data-testid="files-units">
									{units.map((u) => (
										<button key={u.code} type="button" title={u.title} aria-pressed={unit === u.code} onClick={() => setUnit(u.code)}
											className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors",
												unit === u.code ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>
											{u.code}
										</button>
									))}
								</div>
							)}
							{!unit ? (
								<p className="text-sm text-muted-foreground">Pick your units in Hub files first; their papers and notes show here.</p>
							) : local === null ? (
								<p className="text-sm text-muted-foreground"><BrailleSpinner label="Loading files" /> Loading {unit}…</p>
							) : (
								<>
									<section aria-labelledby="files-solutions">
										<h3 id="files-solutions" className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Marking schemes and solutions</h3>
										{solutions.length ? (
											<ul>{solutions.map((f) => row(f.path, f.name, <FileCheck2Icon className="size-4 shrink-0 text-primary" aria-hidden />, () => void openSaved(f), "Open", "files-solution"))}</ul>
										) : <p className="text-sm text-muted-foreground">None for {unit} yet. Ask the tutor for a marking scheme and it is saved here.</p>}
									</section>
									<section aria-labelledby="files-saved">
										<h3 id="files-saved" className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">On this computer</h3>
										{saved.length ? (
											<ul>{saved.map((f) => row(f.path, f.name, <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />, () => void openSaved(f), "Open", "files-saved"))}</ul>
										) : <p className="text-sm text-muted-foreground">No {unit} files saved yet.</p>}
									</section>
									{hub === null ? (
										<p className="text-xs text-muted-foreground"><BrailleSpinner label="Checking the Hub" /> Checking the Hub…</p>
									) : later.length > 0 && (
										<section aria-labelledby="files-hub">
											<h3 id="files-hub" className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">On the Hub (downloads once)</h3>
											<ul>{later.map((f) => row(f.id, f.name, <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />, () => void openHub(f), "Open", "files-hub"))}</ul>
										</section>
									)}
								</>
							)}
						</div>
					)}
					{message && <p role="alert" className="mt-4 text-sm text-destructive">{message}</p>}
				</div>
			</div>
		</dialog>
	);
}
