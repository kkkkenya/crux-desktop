"use client";
/**
 * Updates without leaving Crux Harness (owner, 2026-11-20), and the logo when setup is done.
 *
 * The green bar: Crux Harness checks for a new version when it opens and every six hours. A small update (a server
 * patch, electron/crux-patch.cjs) is fetched by the shell in the background where it can (stageUpdate, 0.8.0 and
 * later), else when the student taps Restart. An update that needs a new installer is downloaded in the background
 * by the app's own server (src/server/crux-installer.ts) and installed silently on Restart: no browser, no GitHub
 * page, no installer to click through. Either way the student sees one green bar: "Crux Harness 0.8.0 is ready. Restart".
 *
 * The welcome: the first time Crux Harness opens after setup or an update, the Crux logo animation plays
 * (public/crux-logo.mp4, 3 seconds). Tap or Esc skips it; with reduced motion it is not shown.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cruxBridge } from "@/components/crux-study";

type Bar = { kind: "patch" | "installer"; version: string; phase: "ready" | "working" | "failed"; error?: string };
const CHECK_MS = 6 * 60 * 60 * 1000;
const WAIT_MS = 30 * 1000;
const WELCOMED = "crux:welcomed-version";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* a convenience */ } };

/** What the bar says. Pure, for tests. */
export function barCopy(bar: Bar): { text: string; action: string | null } {
	if (bar.phase === "failed") return { text: bar.error || "The update didn't finish. It will try again later.", action: "Try again" };
	if (bar.phase === "working") return { text: bar.kind === "installer" ? "Installing. Crux Harness closes and opens again by itself." : "Updating. Crux Harness restarts by itself in a moment.", action: null };
	return { text: `Crux Harness ${bar.version} is ready. Your sessions and notes stay.`, action: "Restart" };
}

/** Whether the welcome plays on this open: a version not welcomed yet, and motion allowed. Pure, for tests. */
export const welcomeDue = (current: string | undefined, welcomed: string | null, reducedMotion: boolean) => Boolean(current) && welcomed !== current && !reducedMotion;

type Bridge = NonNullable<ReturnType<typeof cruxBridge>> & { stageUpdate?: () => Promise<{ ok: boolean; value?: unknown; error?: string }> };

export function CruxUpdates() {
	const [bar, setBar] = useState<Bar | null>(null);
	const [hidden, setHidden] = useState(false);
	const [welcome, setWelcome] = useState<"off" | "on" | "leaving">("off");
	const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);

	const waitForInstaller = useCallback((current: string) => {
		const poll = async () => {
			const r = await fetch(`/api/crux-update?current=${encodeURIComponent(current)}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null) as { status?: string; version?: string } | null;
			if (r?.status === "ready" && r.version) setBar({ kind: "installer", version: r.version, phase: "ready" });
			else if (r?.status === "downloading") waiting.current = setTimeout(() => void poll(), WAIT_MS);
		};
		void poll();
	}, []);

	const check = useCallback(async (first: boolean) => {
		const bridge = cruxBridge() as Bridge | undefined;
		if (!bridge?.updateCheck) return;
		const reply = await bridge.updateCheck().catch(() => null);
		if (!reply?.ok) return;
		const { available, version, current, patch } = reply.value;
		if (first && welcomeDue(current, read(WELCOMED), window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)) setWelcome("on");
		if (current) write(WELCOMED, current);
		if (!available || !version) return;
		if (patch) {
			if (bridge.stageUpdate) {
				const staged = await bridge.stageUpdate().catch(() => null);
				if (staged?.ok) setBar({ kind: "patch", version, phase: "ready" });
			} else setBar({ kind: "patch", version, phase: "ready" }); // 0.7.x shells fetch it when Restart is tapped
		} else if (current) waitForInstaller(current);
	}, [waitForInstaller]);

	useEffect(() => {
		void check(true);
		const timer = setInterval(() => void check(false), CHECK_MS);
		return () => { clearInterval(timer); if (waiting.current) clearTimeout(waiting.current); };
	}, [check]);

	const restart = async () => {
		if (!bar) return;
		setBar({ ...bar, phase: "working" });
		if (bar.kind === "patch") {
			const reply = await cruxBridge()?.applyUpdate?.().catch(() => null);
			if (!reply?.ok) setBar({ ...bar, phase: "failed", error: reply && !reply.ok ? (reply as { error: string }).error : undefined });
			return;
		}
		const r = await fetch("/api/crux-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: bar.version }) }).then((x) => x.json()).catch(() => null) as { ok?: boolean; error?: string } | null;
		if (!r?.ok) setBar({ ...bar, phase: "failed", error: r?.error });
	};

	const leave = useCallback(() => { setWelcome("leaving"); setTimeout(() => setWelcome("off"), 450); }, []);
	useEffect(() => {
		if (welcome !== "on") return;
		const key = (e: KeyboardEvent) => { if (e.key === "Escape") leave(); };
		window.addEventListener("keydown", key);
		const fallback = setTimeout(leave, 6000); // a video that never plays never blocks the app
		return () => { window.removeEventListener("keydown", key); clearTimeout(fallback); };
	}, [welcome, leave]);

	const copy = bar && !hidden ? barCopy(bar) : null;
	return (
		<>
			{copy && (
				<div role="status" data-testid="crux-update-bar" className="lh-no-drag fixed inset-x-0 top-2 z-[60] flex justify-center px-4">
					<div className="flex max-w-xl items-center gap-3 rounded-full bg-[#1e8e4e] py-1.5 pl-4 pr-1.5 text-sm text-white shadow-lg">
						<span>{copy.text}</span>
						{copy.action && (
							<button type="button" onClick={() => void restart()} data-testid="crux-update-restart"
								className="cursor-pointer rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#14653a] hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
								{copy.action}
							</button>
						)}
						{bar?.phase !== "working" && (
							<button type="button" aria-label="Hide until later" onClick={() => setHidden(true)} className="cursor-pointer rounded-full px-2 py-1 text-white/80 hover:text-white">×</button>
						)}
					</div>
				</div>
			)}
			{welcome !== "off" && (
				<div data-testid="crux-welcome" onClick={leave} aria-hidden="true"
					className={`fixed inset-0 z-[70] flex cursor-pointer items-center justify-center bg-[#120e0c] transition-opacity duration-[450ms] ${welcome === "leaving" ? "opacity-0" : "opacity-100"}`}>
					<video src="/crux-logo.mp4" autoPlay muted playsInline onEnded={leave} onError={leave} className="h-full max-h-[70vh] w-full max-w-[1200px] object-contain" />
				</div>
			)}
		</>
	);
}
