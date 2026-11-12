"use client";

/**
 * The Crux look that lives on <html>: which wallpaper, and whether it moves.
 * Same choices and the same storage keys as Crux on the web (crux-wp,
 * crux-motion), kept on this device. The wallpapers themselves are CSS
 * (app/crux-wallpaper.css): html[data-wp] picks one, html[data-motion="off"]
 * holds it still.
 */
import { useEffect, useState } from "react";

export const WALLPAPERS = [
	["auto", "Ember (default)"],
	["lagoon", "Lagoon"],
	["ember", "Ember"],
	["dusk", "Dusk"],
	["harbor", "Harbor"],
	["fern", "Fern"],
] as const;
export type Wallpaper = (typeof WALLPAPERS)[number][0];

const WP_KEY = "crux-wp";
const MOTION_KEY = "crux-motion";
const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private storage: the choice lasts this window only */ } };

export function storedWallpaper(): Wallpaper {
	const value = read(WP_KEY);
	return WALLPAPERS.some(([id]) => id === value) ? (value as Wallpaper) : "auto";
}
/** Moving by default; still when the student said so or the device asks for less motion. */
export function storedMotion(): boolean {
	const value = read(MOTION_KEY);
	if (value === "on" || value === "off") return value === "on";
	return typeof matchMedia === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function apply(wallpaper: Wallpaper, motion: boolean) {
	const root = document.documentElement;
	root.dataset.wp = wallpaper;
	root.dataset.motion = motion ? "on" : "off";
}

/** Applies the stored look once the page is live. Renders nothing. */
export function CruxLook() {
	useEffect(() => { apply(storedWallpaper(), storedMotion()); }, []);
	return null;
}

/** The two controls for Settings → Appearance. */
export function useCruxLook() {
	const [wallpaper, setWallpaperState] = useState<Wallpaper>("auto");
	const [motion, setMotionState] = useState(true);
	useEffect(() => { setWallpaperState(storedWallpaper()); setMotionState(storedMotion()); }, []);
	return {
		wallpaper,
		motion,
		setWallpaper: (next: Wallpaper) => { setWallpaperState(next); write(WP_KEY, next); apply(next, motion); },
		setMotion: (next: boolean) => { setMotionState(next); write(MOTION_KEY, next ? "on" : "off"); apply(wallpaper, next); },
	};
}
