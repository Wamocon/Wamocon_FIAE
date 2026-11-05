/**
 * Chat chain for a turn that holds trainer knowledge (text of the model
 * solutions of the private bucket), when the owner wants such turns answered by
 * the own AI Sokrates only (HAI_TRAINER_SOLUTIONS_CHAT=sokrates). The primary
 * provider (Gemini) is left out, nothing else changes. Without Sokrates the chat
 * is unavailable for that turn, never a silent switch to another provider.
 *
 * Pure, no imports of the providers themselves.
 *
 * @module lib/hai/providers/sokratesOnly
 */

/** The part of a chat chain this module needs. */
export interface ChainLike<TProvider> {
  primary: TProvider | null;
  fallback: TProvider | null;
}

/** The same chain without its primary provider. */
export function sokratesOnlyChain<
  TProvider,
  TChain extends ChainLike<TProvider>,
>(chain: TChain): TChain {
  return { ...chain, primary: null };
}
