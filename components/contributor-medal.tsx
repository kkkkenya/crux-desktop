/**
 * The contributor medal (owner, 2026-11-12: "like Duolingo, not an emoji"): a flat,
 * chunky badge with a darker edge underneath for depth, a shine, a star, and ribbon
 * tails. Original artwork; the same drawing is in Crux web (study/web/src/Medal.jsx).
 */
export function ContributorMedal({ className = "", title = "Contributor medal" }: { className?: string; title?: string }) {
	return (
		<svg viewBox="0 0 64 72" className={className} role="img" aria-label={title}>
			<title>{title}</title>
			{/* ribbon tails */}
			<path d="M18 44 L10 68 L19 63 L24 70 L30 48 Z" fill="#e5484d" />
			<path d="M46 44 L54 68 L45 63 L40 70 L34 48 Z" fill="#c9343a" />
			{/* depth: the darker disc showing under the face */}
			<circle cx="32" cy="32" r="25" fill="#c98a00" />
			{/* face */}
			<circle cx="32" cy="28" r="25" fill="#ffc800" />
			<circle cx="32" cy="28" r="18.5" fill="#ffdb4d" />
			{/* shine */}
			<path d="M16 22 A17 17 0 0 1 30 11.5" stroke="#fff" strokeOpacity="0.7" strokeWidth="4" strokeLinecap="round" fill="none" />
			{/* star */}
			<path d="M32 16.5 L35.4 23.6 L43.2 24.5 L37.4 29.8 L39 37.5 L32 33.6 L25 37.5 L26.6 29.8 L20.8 24.5 L28.6 23.6 Z"
				fill="#fff7cc" stroke="#d99a00" strokeWidth="2.2" strokeLinejoin="round" />
		</svg>
	);
}
