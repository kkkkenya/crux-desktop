/**
 * The app mark: Crux's Hub tile, a yellow rounded square with "EH" (Engineering Hub),
 * the same mark Crux uses on the web. Inlined as JSX so it needs no network fetch and
 * stays crisp at any size. 128×128 viewBox, no padding: sizing is the consumer's job.
 * The letters are drawn as rectangles so the mark never depends on an installed font.
 *
 * Still exported as LhMark (the name the shell imports) from the LearnHarness original.
 */
export function LhMark({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="0 0 128 128" className={className} aria-hidden="true">
			<rect x="4" y="4" width="120" height="120" rx="28" fill="#f2c200" />
			<g fill="#0b0f14">
				{/* E */}
				<rect x="25" y="38" width="12" height="42" />
				<rect x="25" y="38" width="35" height="10" />
				<rect x="25" y="54" width="32" height="10" />
				<rect x="25" y="70" width="35" height="10" />
				{/* H */}
				<rect x="66" y="38" width="12" height="42" />
				<rect x="91" y="38" width="12" height="42" />
				<rect x="66" y="54" width="37" height="10" />
			</g>
		</svg>
	);
}
