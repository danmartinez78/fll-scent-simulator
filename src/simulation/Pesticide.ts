/**
 * Pesticide: sprayed like the scent spray, but it kills insects it touches
 * instead of moving them. It kills pests (even the ones that ignore scent,
 * except a few that are resistant) and it kills helpful insects (bees and
 * ladybugs) the same way. It sits on the plants and wears off over days.
 */
export const PESTICIDE_RULES = {
  /** Days (model minutes) for pesticide on the plants to fall to about 37%. */
  lifetimeMin: 3,
  /** Below this concentration pesticide no longer kills. */
  lethal: 0.3,
  /** Kill chance per model second at full strength (concentration 1 or more). */
  killPerSec: 0.05,
  /** Share of pests that are resistant to the pesticide (common after years of use). */
  resistantShare: 0.15
};

/** Kill rate (per model second) at a concentration of pesticide. */
export function pesticideKillRate(concentration: number): number {
  if (concentration <= PESTICIDE_RULES.lethal) return 0;
  return PESTICIDE_RULES.killPerSec * Math.min(1, concentration);
}
