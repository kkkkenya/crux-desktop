"use client";

/**
 * Study from your phone (Crux, 2026-11-18): leave the laptop on at home and study from the phone's browser at school.
 * The laptop does the work; the phone is a screen. Turned on here only; a phone pairs once by scanning the code.
 * electron/crux-remote.cjs has the proxy, the pairing and the tunnel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { SmartphoneIcon, XIcon } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { Button } from "@/components/ui/button";

export interface RemoteState { on: boolean; url: string | null; phones: { id: string; name: string; pairedAt: number; lastSeen: number }[]; codeOpen: boolean; helper: boolean; helperMB: number; awake: boolean; pairUrl?: string; expiresAt?: number }
type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface RemoteBridge {
	status: () => Promise<Reply<RemoteState>>;
	enable: () => Promise<Reply<RemoteState>>;
	disable: () => Promise<Reply<RemoteState>>;
	newCode: () => Promise<Reply<RemoteState>>;
	removePhone: (id: string) => Promise<Reply<RemoteState>>;
	setAwake: (on: boolean) => Promise<Reply<RemoteState>>;
	onProgress: (cb: (p: { step: "download" | "tunnel"; p?: number }) => void) => () => void;
}

const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

export function PhoneDialog({ onClose }: { onClose: () => void }) {
	const bridge = typeof window === "undefined" ? undefined : (window.lh as { remote?: RemoteBridge } | undefined)?.remote;
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [st, setSt] = useState<RemoteState | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [progress, setProgress] = useState<{ step: string; p?: number } | null>(null);
	const [problem, setProblem] = useState("");
	const [qr, setQr] = useState("");
	useEffect(() => { const d = dialogRef.current; if (d && !d.open) d.showModal(); }, []);
	useEffect(() => { void bridge?.status().then((r) => r.ok && setSt(r.value)); return bridge?.onProgress(setProgress); }, [bridge]);
	useEffect(() => {
		if (!st?.pairUrl) { setQr(""); return; }
		void QRCode.toString(st.pairUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } }).then(setQr);
	}, [st?.pairUrl]);
	const run = useCallback(async (what: string, call: () => Promise<Reply<RemoteState>> | undefined) => {
		setBusy(what); setProblem("");
		const r = await call()?.catch(() => null);
		setBusy(null); setProgress(null);
		if (!r) { setProblem("Crux Harness could not do that. Try again."); return; }
		if (!r.ok) { setProblem(r.error); return; }
		setSt((old) => ({ ...r.value, pairUrl: r.value.pairUrl ?? (r.value.on ? old?.pairUrl : undefined), expiresAt: r.value.expiresAt ?? old?.expiresAt }));
	}, []);
	const expired = st?.expiresAt ? st.expiresAt < Date.now() : true;

	return (
		<dialog ref={dialogRef} onClose={onClose} aria-labelledby="phone-title" data-testid="phone-dialog"
			className="lh-no-drag m-auto max-h-[88vh] w-[min(520px,92vw)] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60">
			<div className="flex max-h-[88vh] flex-col">
				<header className="flex items-start gap-3 border-b border-border/60 px-6 pb-4 pt-5">
					<div className="min-w-0 flex-1">
						<h2 id="phone-title" className="font-title text-2xl tracking-tight">Study from your phone</h2>
						<p className="mt-1 text-xs text-muted-foreground">Leave this laptop on and open Crux in your phone's browser, anywhere with internet. The laptop does the work.</p>
					</div>
					<Button type="button" size="icon-sm" variant="ghost" className="cursor-pointer" aria-label="Close" onClick={() => dialogRef.current?.close()}><XIcon className="size-4" /></Button>
				</header>
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 text-sm">
					{!bridge ? <p className="text-muted-foreground">This works in the Crux Harness app on a laptop.</p> : !st ? <p className="text-muted-foreground"><BrailleSpinner label="Loading" /> Loading…</p> : !st.on ? (
						<>
							<p>Turn this on, then scan the code with your phone. Each phone pairs once; you can remove a phone at any time.</p>
							{!st.helper && <p className="text-muted-foreground">The first time, Crux downloads Cloudflare's tunnel helper (about {st.helperMB} MB). Use Wi-Fi if you can.</p>}
							<p className="text-muted-foreground">Keys, models and settings can only be changed on this laptop.</p>
							<Button className="cursor-pointer" disabled={busy !== null} onClick={() => void run("on", () => bridge.enable())} data-testid="phone-on">
								{busy === "on" ? <BrailleSpinner label="Starting" /> : <SmartphoneIcon className="size-4" />}{busy === "on" ? (progress?.step === "download" ? `Downloading the helper… ${Math.round((progress.p ?? 0) * 100)}%` : "Opening the link…") : "Turn on"}
							</Button>
						</>
					) : (
						<>
							{st.pairUrl && !expired ? (
								<div className="flex flex-col items-center gap-2">
									<div className="crux-phone-qr" aria-label="Pairing code: scan it with your phone's camera" role="img" dangerouslySetInnerHTML={{ __html: qr }} />
									<p className="text-center text-xs text-muted-foreground">Scan with your phone's camera. The code works once, for 10 minutes.</p>
								</div>
							) : (
								<Button variant="outline" className="cursor-pointer" disabled={busy !== null} onClick={() => void run("code", () => bridge.newCode())}>Show a code for another phone</Button>
							)}
							{st.url && <p className="text-xs text-muted-foreground">On a paired phone, open <span className="select-all break-all font-mono text-foreground">{st.url}</span>. The link changes each time this is turned on.</p>}
							<label className="flex items-center gap-2"><input type="checkbox" checked={st.awake} onChange={(e) => void run("awake", () => bridge.setAwake(e.target.checked))} /> Keep this laptop awake while it's on</label>
							<Button variant="outline" className="cursor-pointer" disabled={busy !== null} onClick={() => void run("off", () => bridge.disable())}>Turn off</Button>
						</>
					)}
					{st && st.phones.length > 0 && (
						<section aria-label="Paired phones">
							<h3 className="mb-2 font-medium">Paired phones</h3>
							<ul className="space-y-1">
								{st.phones.map((p) => (
									<li key={p.id} className="flex items-center gap-3">
										<SmartphoneIcon className="size-4 text-muted-foreground" aria-hidden />
										<span className="min-w-0 flex-1"><span className="block truncate">{p.name}</span><span className="block text-xs text-muted-foreground">Last used {ago(p.lastSeen)}</span></span>
										<Button size="xs" variant="ghost" className="cursor-pointer" onClick={() => void run(`rm-${p.id}`, () => bridge?.removePhone(p.id))}>Remove</Button>
									</li>
								))}
							</ul>
						</section>
					)}
					{problem && <p className="text-destructive" role="alert">{problem}</p>}
				</div>
			</div>
		</dialog>
	);
}
