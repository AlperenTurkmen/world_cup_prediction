/**
 * Knockout round identifiers, shared by server and client code.
 * Kept free of any server-only imports so Client Components can use it.
 */
export const ADV_ROUNDS = ["R32", "R16", "QF", "SF", "FINAL", "CHAMPION"] as const;
export type AdvRound = (typeof ADV_ROUNDS)[number];
