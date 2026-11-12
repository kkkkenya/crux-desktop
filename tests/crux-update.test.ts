/**
 * "A new version of Crux is out" (electron/crux-hub.cjs updateCheck/openUpdate):
 * the app reads Crux web's desktop/latest.json and offers only Crux releases.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, it } from "node:test";

const require = createRequire(import.meta.url);
const { createCruxHub, newerVersion } = require("../electron/crux-hub.cjs");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const RELEASE = "https://github.com/kkkkenya/crux-desktop/releases/latest/download/Crux-Setup.exe";

function hub(version = "0.6.0", opened: string[] = []) {
	return createCruxHub({
		app: { getPath: () => "C:\\none", getVersion: () => version },
		BrowserWindow: class {},
		session: { fromPartition: () => ({ fetch: async () => new Response("{}", { status: 401 }), clearStorageData: async () => {} }) },
		shell: { openExternal: async (url: string) => { opened.push(url); }, showItemInFolder: () => {}, openPath: async () => "" },
	});
}
const serve = (body: unknown, status = 200) => {
	const asked: string[] = [];
	globalThis.fetch = (async (url: string) => { asked.push(String(url)); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
	return asked;
};

it("newerVersion compares x.y.z numerically", () => {
	assert.equal(newerVersion("0.7.0", "0.6.0"), true);
	assert.equal(newerVersion("0.10.0", "0.9.9"), true);
	assert.equal(newerVersion("0.6.0", "0.6.0"), false);
	assert.equal(newerVersion("0.5.9", "0.6.0"), false);
	assert.equal(newerVersion("1.0.0", "0.99.99"), true);
});

it("a newer release on Crux web is offered, with its link and note", async () => {
	const asked = serve({ version: "0.7.0", url: RELEASE, notes: "Hosted models." });
	const u = await hub("0.6.0").updateCheck();
	assert.deepEqual(u, { available: true, version: "0.7.0", current: "0.6.0", url: RELEASE, notes: "Hosted models." });
	assert.match(asked[0]!, /\/desktop\/latest\.json$/);
});

it("the same or an older version is not offered", async () => {
	serve({ version: "0.6.0", url: RELEASE });
	assert.equal((await hub("0.6.0").updateCheck()).available, false);
	serve({ version: "0.5.0", url: RELEASE });
	assert.equal((await hub("0.6.0").updateCheck()).available, false);
});

it("a link anywhere but the Crux releases, a bad version, or no connection: nothing is offered", async () => {
	serve({ version: "9.9.9", url: "https://evil.example/Crux-Setup.exe" });
	assert.equal((await hub().updateCheck()).available, false);
	serve({ version: "latest", url: RELEASE });
	assert.equal((await hub().updateCheck()).available, false);
	serve({}, 404);
	assert.equal((await hub().updateCheck()).available, false);
	globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
	assert.deepEqual(await hub().updateCheck(), { available: false });
});

it("openUpdate opens only Crux release links", async () => {
	const opened: string[] = [];
	const h = hub("0.6.0", opened);
	assert.equal(await h.openUpdate(RELEASE), true);
	await assert.rejects(h.openUpdate("https://evil.example/x.exe"), /isn't a Crux release/);
	assert.deepEqual(opened, [RELEASE]);
});
