"use client";

/**
 * Marking schemes (Crux, 2026-11-17): a unit's marking schemes, each beside the paper it
 * marks, ready to open. Students who found a paper usually want only its scheme, not a
 * lesson. The same list as Crux web's Schemes tab (study/server/schemes.js). A scheme opens
 * in Crux's viewer and never uses a daily download; a paper without one can be asked for,
 * which tells the Hub admin. Pages the tutor saved for this student are listed too.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileCheck2Icon, FileTextIcon, XIcon } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openInCrux } from "@/components/crux-reader";
import type { CruxBridge, CruxSchemes, CruxUnit } from "@/components/crux-hub";

const LAST_UNIT = "crux:hub-unit";
const ASKED = "crux:schemes-asked";
export const stem = (name: string) => String(name || "").replace(/ \[\d+\](?=\.[^.]+$)/, "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/_/g, " ").trim();
const askedList = (): string[] => { try { return JSON.parse(localStorage.getItem(ASKED) || "[]") as string[]; } catch { return []; } };

export function SchemesDialog({ bridge, onClose }: { bridge: CruxBridge | undefined; onClose: () => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [units, setUnits] = useState<CruxUnit[] | null>(null);
	const [unit, setUnit] = useState<string | null>(null);
	const [list, setList] = useState<CruxSchemes | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [asked, setAsked] = useState<string[]>([]);
	const [message, setMessage] = useState("");
	const [failed, setFailed] = useState(false);
	const current = useRef<string | null>(null);

	useEffect(() => { const d = dialogRef.current; if (d && !d.open) d.showModal(); setAsked(askedList()); }, []);
	useEffect(() => {
		if (!bridge) return;
		let live = true;
		void bridge.units().then((reply) => {
			if (!live) return;
			if (!reply.ok) { setUnits([]); setMessage(reply.error); return; }
			setUnits(reply.value.mine);
			let last: string | null = null;
			try { last = localStorage.getItem(LAST_UNIT); } catch { /* storage blocked */ }
			const known = [...reply.value.mine, ...reply.value.all];
			setUnit(last && known.some((u) => u.code === last) ? last : reply.value.mine[0]?.code ?? null);
		}).catch(() => { if (live) { setUnits([]); setMessage("Crux could not be reached. Check your connection."); } });
		return () => { live = false; };
	}, [bridge]);

	const load = useCallback(async (code: string) => {
		if (!bridge?.schemes) return;
		current.current = code;
		setList(null); setMessage("");
		const reply = await bridge.schemes(code).catch(() => null);
		if (current.current !== code) return;
		// The hub list could not be read: say why, and show only what is on this computer.
		if (!reply || !reply.ok) {
			setFailed(true);
			setMessage(!reply ? "Crux could not be reached. Check your connection."
				: /no such endpoint/i.test(reply.error) ? "The marking scheme list is not on Crux yet. Try again later." : reply.error);
			setList({ schemes: [], missing: [], saved: [], note: null });
			return;
		}
		setFailed(false);
		setList(reply.value);
	}, [bridge]);
	useEffect(() => {
		if (!unit) return;
		try { localStorage.setItem(LAST_UNIT, unit); } catch { /* storage blocked */ }
		void load(unit);
	}, [unit, load]);

	const open = async (id: string, name: string) => {
		const code = current.current;
		if (!bridge || !code) return;
		setBusy(id); setMessage("");
		const saved = await bridge.download(code, id, name).catch(() => null);
		setBusy(null);
		if (!saved) { setMessage("The file could not be downloaded. Check your connection."); return; }
		if (!saved.ok) { setMessage(saved.error); return; }
		openInCrux({ path: saved.value.path, name });
		dialogRef.current?.close();
	};
	const ask = async (id: string) => {
		const code = current.current;
		if (!bridge?.askScheme || !code) return;
		setBusy(id); setMessage("");
		const reply = await bridge.askScheme(code, id).catch(() => null);
		setBusy(null);
		if (!reply || !reply.ok) { setMessage(reply && !reply.ok ? reply.error : "Crux could not be reached. Check your connection."); return; }
		const next = [...new Set([...askedList(), `${code}|${id}`])].slice(-200);
		try { localStorage.setItem(ASKED, JSON.stringify(next)); } catch { /* not kept */ }
		setAsked(next);
		setMessage("Asked. It shows here when the scheme is on the Hub.");
	};

	const row = (key: string, name: string, sub: string | null, icon: React.ReactNode, actions: React.ReactNode, testid: string) => (
		<li key={key} className="flex items-center gap-3 border-t border-border/60 py-2 first:border-t-0" data-testid={testid}>
			{icon}
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm" title={name}>{name}</span>
				{sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
			</span>
			{actions}
		</li>
	);
	const btn = (key: string, label: string, onClick: () => void, outline = false, disabled = false) => (
		<Button type="button" size="xs" variant={outline ? "outline" : "default"} className="cursor-pointer disabled:cursor-default" disabled={busy !== null || disabled} aria-busy={busy === key} onClick={onClick}>
			{busy === key ? <BrailleSpinner label={label} /> : null}{label}
		</Button>
	);

	return (
		<dialog ref={dialogRef} onClose={onClose}
			onMouseDown={(e) => { const b = dialogRef.current?.getBoundingClientRect(); if (b && (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom)) dialogRef.current?.close(); }}
			aria-labelledby="schemes-title" data-testid="schemes-dialog"
			className="lh-no-drag m-auto max-h-[82vh] w-[min(640px,92vw)] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60">
			<div className="flex max-h-[82vh] flex-col">
				<header className="flex items-start gap-3 border-b border-border/60 px-6 pb-4 pt-5">
					<div className="min-w-0 flex-1">
						<h2 id="schemes-title" className="font-title text-2xl tracking-tight">Marking schemes</h2>
						<p className="mt-1 text-xs text-muted-foreground">The scheme for a paper, without a lesson around it. Opening one never uses a download.</p>
					</div>
					<Button type="button" size="icon-sm" variant="ghost" className="cursor-pointer" aria-label="Close" onClick={() => dialogRef.current?.close()}><XIcon className="size-4" /></Button>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{!bridge?.schemes ? (
						<p className="text-sm text-muted-foreground">Marking schemes open in the Crux desktop app.</p>
					) : units === null ? (
						<p className="text-sm text-muted-foreground"><BrailleSpinner label="Loading your units" /> Loading your units…</p>
					) : (
						<div className="flex flex-col gap-5">
							{units.length > 0 && (
								<div className="flex flex-wrap gap-1.5" data-testid="schemes-units">
									{units.map((u) => (
										<button key={u.code} type="button" title={u.title} aria-pressed={unit === u.code} onClick={() => setUnit(u.code)}
											className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors", unit === u.code ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>
											{u.code}
										</button>
									))}
								</div>
							)}
							{!unit ? <p className="text-sm text-muted-foreground">Pick your units in Hub files first.</p>
								: list === null ? <p className="text-sm text-muted-foreground"><BrailleSpinner label="Loading schemes" /> Loading {unit}…</p>
								: (
									<>
										{!failed && <section aria-labelledby="schemes-hub">
											<h3 id="schemes-hub" className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">On the Hub</h3>
											{list.schemes.length ? (
												<ul>{list.schemes.map((s) => row(s.id, stem(s.name), s.paper ? `For ${stem(s.paper)}` : null, <FileCheck2Icon className="size-4 shrink-0 text-primary" aria-hidden />, btn(s.id, "Open", () => void open(s.id, s.name)), "scheme-row"))}</ul>
											) : <p className="text-sm text-muted-foreground">No marking schemes for {unit} on the Hub yet. Ask for one below.</p>}
										</section>}
										{list.saved.length > 0 && (
											<section aria-labelledby="schemes-saved">
												<h3 id="schemes-saved" className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Made for you</h3>
												<ul>{list.saved.map((f) => row(f.path, stem(f.name), null, <FileCheck2Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />, btn(f.path, "Open", () => { openInCrux({ path: f.path, name: f.name }); dialogRef.current?.close(); }), "scheme-saved"))}</ul>
											</section>
										)}
										{list.missing.length > 0 && (
											<section aria-labelledby="schemes-missing">
												<h3 id="schemes-missing" className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Papers without a scheme yet</h3>
												<ul>{list.missing.map((p) => {
													const done = asked.includes(`${unit}|${p.id}`);
													return row(p.id, stem(p.name), null, <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />,
														<span className="flex shrink-0 gap-1.5">{btn(`paper-${p.id}`, "Paper", () => void open(p.id, p.name), true)}{btn(p.id, done ? "Asked" : "Ask for the scheme", () => void ask(p.id), true, done)}</span>, "scheme-missing");
												})}</ul>
												<p className="mt-2 text-xs text-muted-foreground">Want one now? Open the paper and ask the tutor for its marking scheme. It is saved under Made for you.</p>
											</section>
										)}
									</>
								)}
						</div>
					)}
					{message && <p role="status" className="mt-4 text-sm text-muted-foreground">{message}</p>}
				</div>
			</div>
		</dialog>
	);
}
