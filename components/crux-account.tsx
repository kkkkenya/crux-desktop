"use client";

/**
 * The Crux account gate (Crux desktop). Crux is for Study Hub members: the app
 * opens on a Discord sign-in and shows nothing else until Crux confirms the
 * account and its plan. After that the plan (basic, premium, …) is available
 * to the rest of the app through useCruxAccount().
 *
 * The account lives in the Electron main process (electron/crux-hub.cjs). A
 * recent sign-in keeps working without a connection for a week. In a plain
 * browser (development only, no desktop bridge) the gate stands aside.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrailleSpinner } from "@/components/braille-spinner";
import type { CruxBridge, CruxStatus } from "@/components/crux-hub";
import { LhMark } from "@/components/lh-mark";
import { CruxSetupGate, CruxUpdateNotice } from "@/components/crux-study";
import { Button } from "@/components/ui/button";

export type CruxTier = "trial" | "basic" | "premium" | "vvip" | "owner";
export interface CruxAccount { name: string; tier: CruxTier; offline: boolean; avatar: string | null }

const TIERS: readonly CruxTier[] = ["trial", "basic", "premium", "vvip", "owner"];
// Plans are named after the Southern Cross, brightest star for the highest plan (owner, 2026-11-12).
export const TIER_NAME: Record<CruxTier, string> = { trial: "Imai", basic: "Gacrux", premium: "Mimosa", vvip: "Acrux", owner: "Owner" };
const HUB_URL = "https://www.engineeringhub.site/";
const RECHECK_MS = 10 * 60 * 1000;

/** What the gate shows for a status from the main process. Pure, for tests. */
export function accountFrom(status: CruxStatus & { offline?: boolean }): CruxAccount | null {
	if (!status.signedIn) return null;
	const tier = TIERS.includes(status.tier as CruxTier) ? (status.tier as CruxTier) : null;
	if (!tier) return null; // a plan this build doesn't know is not a way in
	// Only Discord's own picture host: the rail shows it as an image.
	const avatar = typeof status.avatar === "string" && status.avatar.startsWith("https://cdn.discordapp.com/") ? status.avatar : null;
	return { name: status.name || "", tier, offline: status.offline === true, avatar };
}

const AccountContext = createContext<{ account: CruxAccount | null; signOut: () => Promise<void> }>({ account: null, signOut: async () => {} });
export function useCruxAccount() { return useContext(AccountContext); }

function Gate({ problem, busy, onSignIn }: { problem: string; busy: boolean; onSignIn: () => void }) {
	return (
		<main className="crux-gate flex h-dvh flex-col" data-testid="crux-gate">
			{/* The window has no title bar of its own: this strip is what you drag it by. */}
			<div className="lh-drag h-15 shrink-0" />
			<div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-20">
				<div className="flex w-full max-w-sm flex-col items-center text-center">
					<LhMark className="size-18" />
					<h1 className="mt-6 font-title text-3xl tracking-tight">Crux</h1>
					<p className="mt-3 text-base text-muted-foreground">
						Crux finds your level, plans the unit and teaches it one step at a time. It is for Study Hub members.
					</p>
					<Button type="button" size="lg" className="mt-8 w-full cursor-pointer disabled:cursor-not-allowed" disabled={busy} aria-busy={busy} onClick={onSignIn} data-testid="crux-gate-sign-in">
						{busy && <BrailleSpinner label="Waiting for sign-in" />}
						Sign in with Discord
					</Button>
					{problem && <p role="alert" className="mt-4 text-sm text-destructive" data-testid="crux-gate-problem">{problem}</p>}
					<p className="mt-6 text-sm text-muted-foreground">
						Not a member yet?{" "}
						<a href={HUB_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">Join the Study Hub</a>
						{" "}and pick a plan, then sign in here.
					</p>
				</div>
			</div>
		</main>
	);
}

export function CruxAccountGate({ children }: { children: React.ReactNode }) {
	// undefined = still checking; the bridge is read after mount (the server render has none).
	const [status, setStatus] = useState<(CruxStatus & { offline?: boolean }) | undefined>(undefined);
	const [bridge, setBridge] = useState<CruxBridge | null | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");
	const checkedAt = useRef(0);

	const check = useCallback(async (b: CruxBridge) => {
		checkedAt.current = Date.now();
		const reply = await b.status().catch(() => null);
		if (!reply) { setStatus({ signedIn: false }); setProblem("Crux could not check your account. Close Crux and open it again."); return; }
		if (!reply.ok) { setStatus({ signedIn: false }); setProblem(reply.error); return; }
		setStatus(reply.value);
		setProblem(reply.value.signedIn ? "" : reply.value.problem ?? "");
	}, []);

	useEffect(() => {
		const b = window.lh?.crux ?? null;
		setBridge(b);
		if (!b) return;
		void check(b);
		// A plan can change or end while the app is open: look again when the student comes back.
		const back = () => { if (document.visibilityState === "visible" && Date.now() - checkedAt.current > RECHECK_MS) void check(b); };
		document.addEventListener("visibilitychange", back);
		window.addEventListener("focus", back);
		return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
	}, [check]);

	const signIn = useCallback(async () => {
		if (!bridge) return;
		setBusy(true); setProblem("");
		const reply = await bridge.login().catch(() => null);
		setBusy(false);
		if (!reply || !reply.ok) { setProblem(reply?.error ?? "Sign-in did not finish. Try again."); return; }
		setStatus(reply.value);
		if (!reply.value.signedIn) setProblem(reply.value.problem ?? "Sign-in was not finished. Try again when you're ready.");
	}, [bridge]);

	const signOut = useCallback(async () => {
		if (!bridge) return;
		await bridge.logout().catch(() => null);
		setStatus({ signedIn: false }); setProblem("");
	}, [bridge]);

	const account = useMemo<CruxAccount | null>(() => {
		if (bridge === null) return { name: "", tier: "owner", offline: false, avatar: null }; // browser development: no gate
		return status ? accountFrom(status) : null;
	}, [bridge, status]);
	const value = useMemo(() => ({ account, signOut }), [account, signOut]);

	if (bridge === undefined || (bridge && status === undefined)) {
		return <main className="crux-gate flex h-dvh items-center justify-center text-sm text-muted-foreground"><BrailleSpinner label="Opening Crux" /></main>;
	}
	if (!account) {
		const unknownPlan = status?.signedIn ? "Your plan isn't one this version of Crux knows. Update Crux, or ask in the Hub." : "";
		return <Gate problem={problem || unknownPlan} busy={busy} onSignIn={() => void signIn()} />;
	}
	return <AccountContext.Provider value={value}><CruxSetupGate>{children}</CruxSetupGate><CruxUpdateNotice /></AccountContext.Provider>;
}
