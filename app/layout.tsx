import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Manrope } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./crux-wallpaper.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { CruxAccountGate } from "@/components/crux-account";
import { CruxLook } from "@/components/crux-look";

// Crux type: chrome and teaching prose = Manrope, titles = Fraunces, code =
// JetBrains Mono. The tokens that consume these variables are in globals.css.
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const sans = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const title = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"] });

export const metadata: Metadata = {
	title: "Crux",
	description: "Crux finds your level, plans the unit and teaches it step by step, with practice and a map of what you know.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" data-theme="dark" data-wp="auto" data-motion="on" suppressHydrationWarning className={`dark ${sans.variable} ${title.variable} ${mono.variable}`}>
			<body className="min-h-dvh antialiased">
			{/* The Crux wallpaper: a still background, up to two slow layers, and grain. */}
			<div className="wallpaper" aria-hidden="true"><div className="wall" /><div className="wl wl1" /><div className="wl wl2" /></div>
			<CruxLook />
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			{/* Members only: nothing below renders until Crux confirms the account. */}
			<CruxAccountGate>
			<ServerEventsProvider>
				<AppearanceProvider>
					<SidebarProvider>
						<ActivityProvider>
							<AppShell>{children}</AppShell>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
			</ServerEventsProvider>
			</CruxAccountGate>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
		</body>
		</html>
	);
}
