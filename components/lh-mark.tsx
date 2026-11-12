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

/**
 * Plans are named after the stars of the Southern Cross, brightest for the highest plan
 * (owner, 2026-11-12): Acrux (top plan), Mimosa, Gacrux, Imai (free trial). Ginan is spare.
 * The plan's star shines; the others stay faint.
 */
export type PlanStar = "acrux" | "mimosa" | "gacrux" | "imai" | "ginan";
export const PLAN_STAR: Record<string, PlanStar> = { vvip: "acrux", owner: "acrux", premium: "mimosa", basic: "gacrux", trial: "imai" };
export const STAR_NAME: Record<PlanStar, string> = { acrux: "Acrux", mimosa: "Mimosa", gacrux: "Gacrux", imai: "Imai", ginan: "Ginan" };
const STARS: { id: PlanStar; cx: number; cy: number; r: number }[] = [
	{ id: "gacrux", cx: 494, cy: 212, r: 44 },
	{ id: "mimosa", cx: 251, cy: 512, r: 54 },
	{ id: "imai", cx: 802, cy: 399, r: 42 },
	{ id: "acrux", cx: 567, cy: 811, r: 70 },
	{ id: "ginan", cx: 668, cy: 575, r: 20 },
];

export function PlanStars({ star, className = "" }: { star: PlanStar | null; className?: string }) {
	return (
		<svg viewBox="100 60 830 900" className={className} role="img" aria-label={star ? `${STAR_NAME[star]}, your plan's star in the Southern Cross` : "The Southern Cross"}>
			<g stroke="#f2c200" strokeOpacity="0.25" strokeWidth="14" strokeLinecap="round">
				<line x1="494" y1="212" x2="567" y2="811" />
				<line x1="251" y1="512" x2="802" y2="399" />
			</g>
			{STARS.map((s) => (
				<g key={s.id}>
					{s.id === star && <circle cx={s.cx} cy={s.cy} r={s.r * 2.2} fill="#f2c200" opacity="0.25" />}
					<circle cx={s.cx} cy={s.cy} r={s.id === star ? s.r * 1.25 : s.r} fill="#f2c200" opacity={s.id === star ? 1 : 0.3} />
				</g>
			))}
		</svg>
	);
}
