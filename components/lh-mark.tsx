/**
 * The app mark: Crux, the Southern Cross. Five stars and the two lines of the cross,
 * in the current text colour's place of honour: Hub yellow. Inlined as JSX so it needs
 * no network fetch and stays crisp at any size. No background tile here, so it sits on
 * the rail's glass; the tiled version is build/icon-flat.svg (the app icon).
 *
 * Still exported as LhMark (the name the shell imports) from the LearnHarness original.
 */
export function LhMark({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="150 110 730 800" className={className} aria-hidden="true">
			<g stroke="#f2c200" strokeOpacity="0.5" strokeWidth="14" strokeLinecap="round">
				<line x1="494" y1="212" x2="567" y2="811" />
				<line x1="251" y1="512" x2="802" y2="399" />
			</g>
			<g fill="#f2c200">
				<circle cx="494" cy="212" r="44" />
				<circle cx="251" cy="512" r="54" />
				<circle cx="802" cy="399" r="42" />
				<circle cx="567" cy="811" r="70" />
				<circle cx="668" cy="575" r="20" />
			</g>
		</svg>
	);
}
