/**
 * Crux Harness installer updates without a browser (owner, 2026-11-20). When a release needs a new window shell,
 * latest.json on Crux web names a signed installer:
 *   installer: { version, url, sha256, size, sig }
 * `sig` is an Ed25519 signature over "crux-harness-installer|<version>|<sha256>" with the same release key as the
 * in-app updates (electron/crux-patch.cjs, scripts/crux-patch-release.mjs). The app's own server downloads it in
 * the background (no GitHub page, and no "downloaded from the internet" mark, so no SmartScreen prompt), checks
 * size, hash and signature, and runs it silently when the student taps Restart. Pure: no I/O.
 */
import { verify } from "node:crypto";

export const RELEASE_DOWNLOADS = "https://github.com/kkkkenya/crux-desktop/releases/download/";
// The release key's public half: the same as electron/crux-patch.cjs PUBLIC_KEY (tests/crux-update.test.ts checks).
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAp2OiapGUsB/A83fR0sJW75srwjAOI3PHedL8yf1nixc=
-----END PUBLIC KEY-----
`;
const VERSION = /^\d+\.\d+\.\d+$/;
const MAX_BYTES = 500 * 1024 * 1024;

export interface SignedInstaller { version: string; url: string; sha256: string; size: number; sig: string }

export const installerSignedText = (p: { version: string; sha256: string }) => `crux-harness-installer|${p.version}|${String(p.sha256).toLowerCase()}`;

export function compareVersions(a: string, b: string): number {
	const x = a.split(".").map(Number), y = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
	return 0;
}

/** An installer link from our own releases: https, github.com, our release path, a .exe, nothing extra. */
export function installerUrl(raw: unknown): boolean {
	let u: URL;
	try { u = new URL(String(raw)); } catch { return false; }
	return u.href.startsWith(RELEASE_DOWNLOADS) && u.pathname.endsWith(".exe") && !u.search && !u.hash && !u.username && !u.password;
}

/** latest.json's installer, when this app may run it: signed, newer than what runs, a sane size. Else null. */
export function usableInstaller(latest: unknown, running: string, publicKey = RELEASE_PUBLIC_KEY): SignedInstaller | null {
	const p = (latest as { installer?: Partial<SignedInstaller> } | null)?.installer;
	if (!p || typeof p !== "object" || !VERSION.test(String(running))) return null;
	if (!VERSION.test(String(p.version)) || compareVersions(String(p.version), running) <= 0) return null;
	if (!installerUrl(p.url)) return null;
	if (!/^[0-9a-f]{64}$/i.test(String(p.sha256 ?? "")) || !Number.isInteger(p.size) || p.size! <= 0 || p.size! > MAX_BYTES) return null;
	let signed = false;
	try { signed = verify(null, Buffer.from(installerSignedText(p as SignedInstaller)), publicKey, Buffer.from(String(p.sig ?? ""), "base64")); } catch { signed = false; }
	if (!signed) return null;
	return { version: p.version!, url: p.url!, sha256: p.sha256!.toLowerCase(), size: p.size!, sig: p.sig! };
}
