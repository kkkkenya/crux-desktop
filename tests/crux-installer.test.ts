/**
 * Installer updates in the background (owner, 2026-11-20): src/core/crux-update.ts and src/server/crux-installer.ts.
 * Signed with a throwaway key; the download is a fake. Uses a throwaway LH_DATA_DIR.
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, it } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crux-installer-"));
process.env.LH_DATA_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { installerSignedText, usableInstaller, RELEASE_PUBLIC_KEY } = await import("../src/core/crux-update.ts");
const { stageInstaller, stageSettled, installStaged, installerState, resetInstallerForTests } = await import("../src/server/crux-installer.ts");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();
const exe = Buffer.from("MZ pretend installer");
const sha256 = createHash("sha256").update(exe).digest("hex");
const URL0 = "https://github.com/kkkkenya/crux-desktop/releases/download/v0.8.0/Crux-Setup.exe";
const signed = (over: Record<string, unknown> = {}) => {
	const p = { version: "0.8.0", url: URL0, sha256, size: exe.length, ...over };
	return { ...p, sig: sign(null, Buffer.from(installerSignedText(p as never)), privateKey).toString("base64") };
};
const fakeFetch = (latest: unknown, body = exe) => (async (url: string) => (String(url).endsWith("latest.json")
	? new Response(JSON.stringify(latest), { status: 200 })
	: new Response(body, { status: 200 }))) as unknown as typeof fetch;

beforeEach(() => { resetInstallerForTests(); fs.rmSync(path.join(dir, "updates"), { recursive: true, force: true }); });

it("the app holds the same release key as the shell", () => {
	assert.ok(fs.readFileSync(path.join(import.meta.dirname, "..", "electron", "crux-patch.cjs"), "utf8").includes(RELEASE_PUBLIC_KEY.trim().split("\n")[1]!));
});

it("usableInstaller: only a signed, newer installer from our releases", () => {
	assert.equal(usableInstaller({ installer: signed() }, "0.7.1", PUB)?.version, "0.8.0");
	assert.equal(usableInstaller({ installer: signed() }, "0.8.0", PUB), null, "not newer");
	assert.equal(usableInstaller({ installer: { ...signed(), sha256: "0".repeat(64) } }, "0.7.1", PUB), null, "signature no longer matches");
	assert.equal(usableInstaller({ installer: signed({ url: "https://evil.example/Crux-Setup.exe" }) }, "0.7.1", PUB), null, "not our releases");
	assert.equal(usableInstaller({ installer: signed({ url: URL0.replace(".exe", ".zip") }) }, "0.7.1", PUB), null, "not an installer");
	assert.equal(usableInstaller({ installer: signed() }, "0.7.1"), null, "a key we don't trust");
	assert.equal(usableInstaller({}, "0.7.1", PUB), null);
});

it("stage: downloads in the background, checks it, and says ready; install runs it silently", async () => {
	assert.equal(stageInstaller("0.7.1", { fetcher: fakeFetch({ installer: signed() }), publicKey: PUB, origin: "https://crux.test" }).status, "checking", "never 'none' while it is still looking");
	await stageSettled();
	assert.deepEqual(installerState(), { status: "ready", version: "0.8.0" });
	const file = path.join(dir, "updates", "Crux-Harness-0.8.0-setup.exe");
	assert.equal(fs.readFileSync(file).toString(), exe.toString());
	const calls: unknown[][] = [];
	const run = ((cmd: string, args: string[], opts: unknown) => { calls.push([cmd, args, opts]); return { unref() {} }; }) as never;
	assert.deepEqual(installStaged("0.9.9", run), { ok: false, error: "The update isn't ready yet." });
	assert.deepEqual(installStaged("0.8.0", run), { ok: true });
	assert.equal(calls[0]![0], file);
	assert.deepEqual(calls[0]![1], ["/S", "--force-run"]);
	assert.equal((calls[0]![2] as { detached: boolean }).detached, true);
});

it("a download that doesn't match the release is refused; a changed file is never run", async () => {
	stageInstaller("0.7.1", { fetcher: fakeFetch({ installer: signed() }, Buffer.from("MZ something else!!")), publicKey: PUB, origin: "https://crux.test" });
	await stageSettled();
	assert.equal(installerState().status, "failed");
	resetInstallerForTests();
	stageInstaller("0.7.1", { fetcher: fakeFetch({ installer: signed() }), publicKey: PUB, origin: "https://crux.test" });
	await stageSettled();
	fs.writeFileSync(path.join(dir, "updates", "Crux-Harness-0.8.0-setup.exe"), "MZ tampered after download");
	let ran = false;
	assert.equal(installStaged("0.8.0", (() => { ran = true; return { unref() {} }; }) as never).ok, false);
	assert.equal(ran, false);
});
