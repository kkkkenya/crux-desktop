"use client";

/**
 * For anyone who can't sign in (Crux, 2026-11-16): Crux is for Study Hub members whose
 * plan an admin has checked on the Discord server. The same steps as Crux web's
 * sign-in screen (study/web/src/Gate.jsx HowToJoin), with the #plans picture from Crux web.
 */
import { useState } from "react";

const INVITE = "https://discord.gg/7yUz2rXumm";
const PLANS = "https://discord.com/channels/1114845424004632597/1554749649280049246";
const PICTURE = "https://crux.engineeringhub.site/plans-channel.png";

export function CruxJoinHelp({ open = false }: { open?: boolean }) {
	const [shot, setShot] = useState(true);
	return (
		<details open={open} data-testid="crux-join-help" className="w-full rounded-lg border border-border/70 px-3 py-2 text-left text-sm">
			<summary className="cursor-pointer text-center font-medium">No Discord account, or no access yet?</summary>
			<p className="mt-2 text-muted-foreground">Crux is for Study Hub members. Are you a member of the Study Hub on Discord? Have you paid for a plan, and has an admin checked your Discord account on the server?</p>
			<ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
				<li>Join the Study Hub on Discord. Make a Discord account first if you don&apos;t have one.</li>
				<li>Go to <b className="text-foreground">#plans</b>, pay by M-Pesa and press <b className="text-foreground">I&apos;ve paid</b>.</li>
				<li>An admin checks your payment and your Discord account. You get a DM, then sign in here.</li>
			</ol>
			{/* eslint-disable-next-line @next/next/no-img-element -- a picture from Crux web, hidden when offline */}
			{shot && <img src={PICTURE} alt="The #plans channel: the plans, how to pay, and the I've paid button" loading="lazy" onError={() => setShot(false)} className="mt-3 w-full rounded-md" />}
			<div className="mt-3 flex flex-wrap justify-center gap-2">
				<a href={INVITE} target="_blank" rel="noopener noreferrer" className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">Join the Study Hub</a>
				<a href={PLANS} target="_blank" rel="noopener noreferrer" className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent">Open #plans</a>
			</div>
		</details>
	);
}
