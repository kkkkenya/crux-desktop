/**
 * Model order in the pickers (owner, 2026-11-12): the best models the student
 * has first, then the older ones. "Best" without release dates in the catalog:
 *
 * 1. Each model family's current generation (the highest version in its ids)
 *    comes before its older generations. An id with no version (deepseek-chat,
 *    the Claude Code aliases) is the provider's current alias, so it counts as current.
 * 2. Within that, the stronger tier first: opus / pro / reasoner, then the
 *    standard size, then haiku / flash / mini, then lite / nano.
 * 3. Then newer generations before older ones, then id and provider.
 */
type Rankable = { provider: string; id: string };

/** The family a version belongs to: provider plus the id's leading word (claude, gpt, o, gemini, glm…). */
export function modelFamily(m: Rankable): string {
	const word = /^[a-z]+/i.exec(m.id.replace(/^.*\//, ""))?.[0]?.toLowerCase() ?? "";
	return `${m.provider}:${word}`;
}

/** The version in an id ("claude-sonnet-4-5-20250929" → 4.5, "gpt-4.1-mini" → 4.1, "o3" → 3), or null. Dates are ignored. */
export function modelVersion(id: string): number | null {
	const bare = id.replace(/^.*\//, "").toLowerCase();
	const m = /(?:^|[^\d])(\d{1,2})(?:[.-](\d{1,2}))?(?=[^\d]|$)/.exec(bare.replace(/\d{6,}/g, ""));
	if (!m) return null;
	return Number(m[1]) + (m[2] ? Number(m[2]) / (m[2].length === 1 ? 10 : 100) : 0);
}

/** 3 = top tier, 2 = standard, 1 = small, 0 = smallest. */
export function modelTier(id: string): number {
	// Whole words of the id only: "gemini" must not read as "mini".
	const words = new Set(id.toLowerCase().replace(/^.*\//, "").split(/[^a-z0-9]+/));
	const has = (...w: string[]) => w.some((x) => words.has(x));
	if (has("lite", "nano", "tiny")) return 0;
	if (has("haiku", "flash", "mini", "small", "air")) return 1;
	if (has("opus", "pro", "max", "reasoner", "ultra", "large")) return 3;
	return 2;
}

export function rankModels<T extends Rankable>(models: readonly T[]): T[] {
	const newest = new Map<string, number>();
	for (const m of models) {
		const v = modelVersion(m.id);
		if (v !== null) newest.set(modelFamily(m), Math.max(newest.get(modelFamily(m)) ?? 0, v));
	}
	const info = (m: T) => {
		const v = modelVersion(m.id);
		const top = newest.get(modelFamily(m));
		return { current: v === null || top === undefined || v >= top, version: v ?? top ?? 0, tier: modelTier(m.id) };
	};
	return [...models].sort((a, b) => {
		const x = info(a), y = info(b);
		return Number(y.current) - Number(x.current)
			|| y.tier - x.tier
			|| y.version - x.version
			|| a.id.localeCompare(b.id)
			|| a.provider.localeCompare(b.provider); // the same model from two providers sits together
	});
}

/** A comparator for lists that sort themselves (SearchMenuList). */
export function compareModelsBestFirst<T extends Rankable>(all: readonly T[]): (a: T, b: T) => number {
	const order = new Map(rankModels(all).map((m, i) => [`${m.provider}/${m.id}`, i]));
	return (a, b) => (order.get(`${a.provider}/${a.id}`) ?? 0) - (order.get(`${b.provider}/${b.id}`) ?? 0);
}
