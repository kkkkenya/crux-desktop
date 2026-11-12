"use client";

/**
 * Home-screen tools opened from elsewhere (Crux desktop). Chains and Extract
 * files used to sit as buttons on the home screen; they now live in Settings,
 * Graph. Settings asks for them here: on the home screen the request goes
 * straight to the mounted view (so a file picker opens inside the same
 * click); from any other page it is kept until the home screen mounts.
 */
import { useEffect, useRef } from "react";

export type HomeAction = "chains" | "extract-files" | "extract-folder";
const EVENT = "crux:home-action";
const KEY = "crux:home-action";
const ACTIONS: readonly HomeAction[] = ["chains", "extract-files", "extract-folder"];

/** Returns true when a mounted home view took the request now; false when it waits for the home screen. */
export function requestHomeAction(action: HomeAction): boolean {
	const event = new CustomEvent(EVENT, { detail: action, cancelable: true });
	// A listener calls preventDefault() to say it handled it.
	if (!window.dispatchEvent(event)) return true;
	try { sessionStorage.setItem(KEY, action); } catch { /* storage blocked: the request is lost, Settings still closes */ }
	return false;
}

/** `later` is true for a request kept from another page (no click to open a file picker with). */
export function useHomeAction(handler: (action: HomeAction, later: boolean) => boolean) {
	const ref = useRef(handler);
	ref.current = handler;
	useEffect(() => {
		const onAction = (event: Event) => {
			const action = (event as CustomEvent).detail as HomeAction;
			if (ref.current(action, false)) event.preventDefault();
		};
		window.addEventListener(EVENT, onAction);
		let kept: string | null = null;
		try { kept = sessionStorage.getItem(KEY); } catch { /* storage blocked */ }
		if (kept && (ACTIONS as readonly string[]).includes(kept) && ref.current(kept as HomeAction, true)) {
			try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
		}
		return () => window.removeEventListener(EVENT, onAction);
	}, []);
}
