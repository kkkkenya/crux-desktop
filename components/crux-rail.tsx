"use client";

/**
 * The Crux rail (Crux desktop): the slim strip of icons down the left edge, as
 * on Crux for the web. It replaces the wide sidebar as the app's navigation;
 * the session list is now a panel that one of these icons opens and closes.
 *
 * Also here: the search palette (every function of the app with its shortcut,
 * so nobody starts from an empty box) and "Surprise me".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	DumbbellIcon, KeyboardIcon, LibraryIcon, LogOutIcon, NetworkIcon, PanelLeftIcon, PlusIcon, SearchIcon, SettingsIcon, SparklesIcon,
	type LucideIcon,
} from "lucide-react";
import { TIER_NAME, useCruxAccount } from "@/components/crux-account";
import { HubDialog } from "@/components/crux-hub";
import { LhMark } from "@/components/lh-mark";
import { cn } from "@/lib/utils";
import { kbdEventForAction, type KeyAction } from "@/src/core";

/** Text handed to the next new-session screen (it types it into the box; the student sends it). */
const DRAFT_KEY = "crux:draft";
export function stashDraft(text: string) { try { sessionStorage.setItem(DRAFT_KEY, text); } catch { /* storage blocked: the box just starts empty */ } }
export function takeDraft(): string {
	try {
		const text = sessionStorage.getItem(DRAFT_KEY) ?? "";
		sessionStorage.removeItem(DRAFT_KEY);
		return text;
	} catch { return ""; }
}

const runAction = (action: KeyAction) => window.dispatchEvent(new Event(kbdEventForAction(action)));

export interface PaletteItem { id: string; label: string; hint: string; shortcut?: string; words: string }

/** Every function of the app, in the order a student is likely to want it. */
export const PALETTE: readonly PaletteItem[] = [
	{ id: "teach", label: "Start a new session", hint: "Crux finds your level, then teaches", shortcut: "Ctrl+N", words: "new teach learn lesson" },
	{ id: "practise", label: "Practise", hint: "Problems on what you have learnt", words: "practice problems questions test me" },
	{ id: "surprise", label: "Surprise me", hint: "Crux picks something worth doing now", words: "random anything" },
	{ id: "hub", label: "Hub files", hint: "Notes and past papers for your units", words: "past papers notes download study hub" },
	{ id: "sessions", label: "Show or hide sessions", hint: "Your earlier sessions", shortcut: "Ctrl+B", words: "history list sidebar" },
	{ id: "find-session", label: "Search your sessions", hint: "Find an earlier session by name", shortcut: "Ctrl+Shift+F", words: "find history" },
	{ id: "graph", label: "Knowledge graph", hint: "The map of what you know", shortcut: "Ctrl+G", words: "mind map graph home" },
	{ id: "model", label: "Choose the model", hint: "Which AI model teaches this session", shortcut: "Ctrl+K", words: "model ai deepseek gemini thinking effort" },
	{ id: "settings", label: "Settings", hint: "Providers, appearance, wallpaper, keyboard", shortcut: "Ctrl+,", words: "preferences keys wallpaper appearance" },
	{ id: "shortcuts", label: "Keyboard shortcuts", hint: "The full list", shortcut: "?", words: "keys help cheat sheet" },
];

/** Items whose label, hint or keywords contain every word typed; all of them for an empty box. */
export function searchPalette(query: string, items: readonly PaletteItem[] = PALETTE): PaletteItem[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [...items];
	return items.filter((item) => { const hay = `${item.label} ${item.hint} ${item.words}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

const IDEAS = [
	"Teach me the idea in my units I am most likely to get wrong in an exam.",
	"Find out what I already know about a topic of your choice, then teach me the next step.",
	"Give me one exam-style problem and mark my method, not just my answer.",
];

/** What "Surprise me" starts: a review that is due, else a problem on something from the graph, else an idea. */
export async function pickSurprise(fetcher: typeof fetch = fetch, random: () => number = Math.random): Promise<{ mode: "teach" | "practice"; text: string }> {
	const json = async (url: string) => { try { const r = await fetcher(url); return r.ok ? await r.json() : null; } catch { return null; } };
	const reviews = await json("/api/graph/reviews");
	const due = Array.isArray(reviews?.due) ? reviews.due.filter((d: { name?: unknown }) => typeof d?.name === "string" && d.name) : [];
	if (due.length > 0) {
		const names = due.slice(0, 3).map((d: { name: string }) => d.name).join(", ");
		return { mode: "practice", text: `Review what is due for me: ${names}.` };
	}
	const graph = await json("/api/graph");
	const nodes = Array.isArray(graph?.nodes) ? graph.nodes.filter((n: { name?: unknown }) => typeof n?.name === "string" && n.name) : [];
	if (nodes.length > 0) {
		const node = nodes[Math.floor(random() * nodes.length)] as { name: string };
		return { mode: "practice", text: `Give me a practice problem on ${node.name}.` };
	}
	return { mode: "teach", text: IDEAS[Math.floor(random() * IDEAS.length)]! };
}

function RailButton({ icon: Icon, label, onClick, active, testid, anim }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; testid?: string; anim?: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			aria-pressed={active}
			data-tip={label}
			data-testid={testid}
			data-anim={anim}
			className={cn("crux-rail-btn lh-no-drag", active && "is-active")}
		>
			<Icon className="size-5" strokeWidth={1.75} aria-hidden />
		</button>
	);
}

function Palette({ onClose, onRun }: { onClose: () => void; onRun: (id: string, typed: string) => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [query, setQuery] = useState("");
	const [pick, setPick] = useState(0);
	const matches = useMemo(() => searchPalette(query), [query]);
	// Nothing in the app matches: offer to start a session about what was typed.
	const rows = matches.length > 0 || !query.trim() ? matches
		: [{ id: "ask", label: `Start a session about “${query.trim()}”`, hint: "Crux will find your level first", words: "" } satisfies PaletteItem];
	useEffect(() => { const d = dialogRef.current; if (d && !d.open) d.showModal(); }, []);
	useEffect(() => { setPick(0); }, [query]);
	return (
		<dialog
			ref={dialogRef}
			onClose={onClose}
			onMouseDown={(event) => {
				const box = dialogRef.current?.getBoundingClientRect();
				if (box && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialogRef.current?.close();
			}}
			aria-label="Search Crux"
			data-testid="crux-palette"
			className="crux-glass lh-no-drag m-auto mt-[14vh] w-[min(560px,92vw)] overflow-hidden rounded-xl p-0 text-foreground backdrop:bg-black/50"
		>
			<div className="flex items-center gap-2 border-b border-border/60 px-4">
				<SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
				<input
					autoFocus
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown") { event.preventDefault(); setPick((p) => Math.min(rows.length - 1, p + 1)); }
						else if (event.key === "ArrowUp") { event.preventDefault(); setPick((p) => Math.max(0, p - 1)); }
						else if (event.key === "Enter" && rows[pick]) { event.preventDefault(); onRun(rows[pick]!.id, query.trim()); }
					}}
					placeholder="What do you want to do?"
					aria-label="Search Crux"
					className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
					data-testid="crux-palette-input"
				/>
			</div>
			<ul className="max-h-[52vh] overflow-y-auto p-2" role="listbox" aria-label="What Crux can do">
				{rows.map((item, index) => (
					<li key={item.id} role="option" aria-selected={index === pick}>
						<button
							type="button"
							onMouseEnter={() => setPick(index)}
							onClick={() => onRun(item.id, query.trim())}
							className={cn("flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors", index === pick ? "bg-accent" : "hover:bg-accent/60")}
							data-testid={`crux-palette-${item.id}`}
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium">{item.label}</span>
								<span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
							</span>
							{item.shortcut && <kbd className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{item.shortcut}</kbd>}
						</button>
					</li>
				))}
			</ul>
		</dialog>
	);
}

export function CruxRail({ sessionsOpen, onToggleSessions, onOpenSettings }: { sessionsOpen: boolean; onToggleSessions: () => void; onOpenSettings: () => void }) {
	const router = useRouter();
	const { account, signOut } = useCruxAccount();
	const [palette, setPalette] = useState(false);
	const [hub, setHub] = useState(false);
	const [menu, setMenu] = useState(false);
	const [surprising, setSurprising] = useState(false);

	const surprise = useCallback(async () => {
		if (surprising) return;
		setSurprising(true);
		const { mode, text } = await pickSurprise();
		setSurprising(false);
		stashDraft(text);
		router.push(mode === "practice" ? "/chat/new?mode=practice" : "/chat/new");
	}, [router, surprising]);

	const run = useCallback((id: string, typed: string) => {
		setPalette(false);
		switch (id) {
			case "teach": router.push("/chat/new"); break;
			case "practise": router.push("/chat/new?mode=practice"); break;
			case "surprise": void surprise(); break;
			case "hub": setHub(true); break;
			case "sessions": onToggleSessions(); break;
			case "find-session": if (!sessionsOpen) onToggleSessions(); setTimeout(() => runAction("sessions-search"), 250); break;
			case "graph": router.push("/"); break;
			case "model": runAction("open-model-picker"); break;
			case "settings": onOpenSettings(); break;
			case "shortcuts": runAction("cheat-sheet"); break;
			case "ask": stashDraft(typed); router.push("/chat/new"); break;
		}
	}, [router, surprise, onToggleSessions, onOpenSettings, sessionsOpen]);

	// Ctrl+P (or Cmd+P) opens the palette from anywhere.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") { event.preventDefault(); setPalette(true); }
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const initial = (account?.name || "?").trim().charAt(0).toUpperCase() || "?";
	return (
		<nav className="crux-rail lh-drag" aria-label="Crux" data-testid="crux-rail">
			<Link href="/" aria-label="Home: knowledge graph" data-tip="Home" className="crux-rail-btn lh-no-drag mb-1">
				<LhMark className="crux-rail-mark size-7" />
			</Link>
			<RailButton icon={PlusIcon} label="New session (Ctrl+N)" onClick={() => router.push("/chat/new")} testid="rail-new" anim="spin" />
			<RailButton icon={PanelLeftIcon} label="Sessions (Ctrl+B)" onClick={onToggleSessions} active={sessionsOpen} testid="rail-sessions" anim="slide" />
			<RailButton icon={DumbbellIcon} label="Practise" onClick={() => router.push("/chat/new?mode=practice")} testid="rail-practise" anim="lift" />
			<RailButton icon={NetworkIcon} label="Knowledge graph (Ctrl+G)" onClick={() => router.push("/")} testid="rail-graph" anim="pulse" />
			<span className="crux-rail-sep" aria-hidden />
			<RailButton icon={SearchIcon} label="Search Crux (Ctrl+P)" onClick={() => setPalette(true)} testid="rail-search" anim="lens" />
			<RailButton icon={LibraryIcon} label="Hub files" onClick={() => setHub(true)} testid="rail-hub" anim="lid" />
			<RailButton icon={SparklesIcon} label={surprising ? "Picking something…" : "Surprise me"} onClick={() => void surprise()} testid="rail-surprise" anim="twinkle" />
			<span className="flex-1" />
			<RailButton icon={KeyboardIcon} label="Keyboard shortcuts (?)" onClick={() => runAction("cheat-sheet")} testid="rail-shortcuts" anim="tap" />
			<RailButton icon={SettingsIcon} label="Settings (Ctrl+,)" onClick={onOpenSettings} testid="rail-settings" anim="gear" />
			{account && (
				<div className="relative lh-no-drag">
					<button
						type="button"
						onClick={() => setMenu((open) => !open)}
						aria-label={`Account: ${account.name || "you"}, ${TIER_NAME[account.tier]}`}
						aria-expanded={menu}
						data-tip={`${account.name || "You"} · ${TIER_NAME[account.tier]}`}
						className="crux-rail-avatar"
						data-testid="rail-account"
					>
						{account.avatar ? <img src={account.avatar} alt="" className="size-full rounded-full object-cover" referrerPolicy="no-referrer" /> : initial}
					</button>
					{menu && (
						<div className="crux-glass absolute bottom-0 left-12 z-50 w-56 rounded-xl p-3 text-sm" role="menu">
							<p className="truncate font-medium">{account.name || "Signed in"}</p>
							<p className="text-xs text-muted-foreground">{TIER_NAME[account.tier]} plan{account.offline ? " · offline" : ""}</p>
							<button type="button" role="menuitem" onClick={() => { setMenu(false); void signOut(); }} className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
								<LogOutIcon className="size-3.5" aria-hidden />Sign out
							</button>
						</div>
					)}
				</div>
			)}
			{palette && <Palette onClose={() => setPalette(false)} onRun={run} />}
			{hub && <HubDialog bridge={typeof window === "undefined" ? undefined : window.lh?.crux} onClose={() => setHub(false)} />}
		</nav>
	);
}
