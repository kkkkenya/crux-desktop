import { installerState, installStaged, stageInstaller } from "@/src/server/crux-installer";

/**
 * The background installer update (src/server/crux-installer.ts). proxy.ts already requires the desktop's
 * per-launch secret on every /api route; POST also has to come from this app's own page.
 *   GET  ?current=0.7.1  → look for a newer signed installer and download it in the background: { status, version }
 *   POST { version }     → run the downloaded installer silently (closes the app, installs, reopens)
 */
const HEADERS = { "Cache-Control": "no-store" };
const VERSION = /^\d+\.\d+\.\d+$/;

export function GET(request: Request) {
	const current = new URL(request.url).searchParams.get("current") ?? "";
	if (!VERSION.test(current)) return Response.json(installerState(), { headers: HEADERS });
	return Response.json(stageInstaller(current), { headers: HEADERS });
}

export async function POST(request: Request) {
	const origin = new URL(request.url).origin;
	if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
		return Response.json({ ok: false, error: "Not allowed." }, { status: 403, headers: HEADERS });
	}
	const body = await request.json().catch(() => null) as { version?: unknown } | null;
	const version = typeof body?.version === "string" && VERSION.test(body.version) ? body.version : "";
	const done = installStaged(version);
	return Response.json(done, { status: done.ok ? 200 : 409, headers: HEADERS });
}
