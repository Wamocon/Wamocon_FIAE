/**
 * Learning technique cards (HAI package B): schema and rules of the card set.
 *
 * A card is one JSON file under content/hai/learning-techniques. The cards are
 * platform knowledge (no occupation filter), ranked by effectiveness after
 * Dunlosky et al. (2013). Every card carries a review state: a card is only
 * delivered to the index once a human has set review.reviewed to true (default
 * for every new card: false). Pure module, no file or database access.
 *
 * @module lib/hai/learningTechniques/schema
 */

import { z } from 'zod';
import { findMarkers, otherOccupation } from './occupations';

/** Status text of a card that nobody has released yet. */
export const DRAFT_STATUS = 'Entwurf, ungeprüft gegen Originaltext';
/** Status text of a released card. */
export const RELEASED_STATUS = 'Freigegeben';

/** Occupations with an example on every card (catalog codes). */
export const EXAMPLE_OCCUPATIONS = ['FIAE', 'KFBM'] as const;
export type ExampleOccupation = (typeof EXAMPLE_OCCUPATIONS)[number];

export const EFFECTIVENESS_LEVELS = ['hoch', 'mittel', 'niedrig'] as const;
export type Effectiveness = (typeof EFFECTIVENESS_LEVELS)[number];

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A free text field: not empty, no control characters, bounded. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine(value => !/[\u0000-\u001f\u007f]/.test(value), {
      message: 'control characters are not allowed',
    });

const reviewSchema = z
  .object({
    reviewed: z.boolean(),
    status: text(80),
    reviewedBy: text(120).nullable(),
    reviewedAt: z
      .string()
      .regex(DATE_PATTERN, 'reviewedAt must be YYYY-MM-DD')
      .refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
        message: 'reviewedAt must be a real date',
      })
      .nullable(),
    checked: text(800),
    notChecked: text(800),
  })
  .strict()
  .superRefine((review, ctx) => {
    if (review.reviewed) {
      if (!review.reviewedBy || !review.reviewedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'a released card needs reviewedBy and reviewedAt',
        });
      }
      if (review.status !== RELEASED_STATUS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `a released card has the status "${RELEASED_STATUS}"`,
        });
      }
    } else {
      if (review.status !== DRAFT_STATUS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `an unreleased card has the status "${DRAFT_STATUS}"`,
        });
      }
      if (review.reviewedBy !== null || review.reviewedAt !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'an unreleased card has no reviewedBy and no reviewedAt',
        });
      }
    }
  });

export const learningTechniqueCardSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(ID_PATTERN).max(60),
    rank: z.number().int().min(1).max(99),
    title: text(100),
    effectiveness: z.enum(EFFECTIVENESS_LEVELS),
    /** Card this one applies (own application, not rated by the source). */
    basedOn: z.string().regex(ID_PATTERN).max(60).optional(),
    /** The technique as rated in the source, null for an own application. */
    dunlosky: z
      .object({
        technique: text(80),
        utility: z.enum(['high', 'moderate', 'low']),
      })
      .strict()
      .nullable(),
    keywords: z.array(text(60)).min(2).max(10),
    what: text(500),
    whenUseful: text(400),
    steps: z.tuple([text(300), text(300), text(300)]),
    examples: z.object({ FIAE: text(400), KFBM: text(400) }).strict(),
    source: z
      .object({
        citation: text(500),
        basis: z.enum(['Dunlosky', 'Eigene Anwendung']),
        note: text(400),
      })
      .strict(),
    review: reviewSchema,
  })
  .strict();

export type LearningTechniqueCard = z.infer<typeof learningTechniqueCardSchema>;

const UTILITY_TO_LEVEL = {
  high: 'hoch',
  moderate: 'mittel',
  low: 'niedrig',
} as const satisfies Record<string, Effectiveness>;

/** Parse one card; throws a readable error for a card that breaks the schema. */
export function parseLearningTechniqueCard(
  raw: unknown,
  label = 'card'
): LearningTechniqueCard {
  const result = learningTechniqueCardSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid learning technique card ${label}: ${issues}`);
  }
  const card = result.data;
  if (card.dunlosky) {
    if (UTILITY_TO_LEVEL[card.dunlosky.utility] !== card.effectiveness) {
      throw new Error(
        `Invalid learning technique card ${label}: effectiveness ${card.effectiveness} does not match the rating ${card.dunlosky.utility}`
      );
    }
    if (card.source.basis !== 'Dunlosky') {
      throw new Error(
        `Invalid learning technique card ${label}: a rated technique has the basis Dunlosky`
      );
    }
  } else if (card.source.basis !== 'Eigene Anwendung' || !card.basedOn) {
    throw new Error(
      `Invalid learning technique card ${label}: an own application names its base card and has the basis "Eigene Anwendung"`
    );
  }
  return card;
}

const LEVEL_ORDER: Record<Effectiveness, number> = {
  hoch: 0,
  mittel: 1,
  niedrig: 2,
};

/**
 * Rules over the whole set: 10 to 15 cards, unique ids, ranks 1..n without a
 * gap, the order follows the effectiveness, every base card exists and every
 * example is free of the markers of the other occupation (see
 * occupationMarkers).
 */
export function validateCardSet(cards: readonly LearningTechniqueCard[]): void {
  if (cards.length < 10 || cards.length > 15) {
    throw new Error(`Expected 10 to 15 cards, found ${cards.length}`);
  }
  const ids = new Set<string>();
  for (const card of cards) {
    if (ids.has(card.id)) throw new Error(`Duplicate card id ${card.id}`);
    ids.add(card.id);
  }
  const sorted = [...cards].sort((a, b) => a.rank - b.rank);
  sorted.forEach((card, i) => {
    if (card.rank !== i + 1) {
      throw new Error(`Ranks must be 1..${cards.length} without a gap`);
    }
    if (
      i > 0 &&
      LEVEL_ORDER[card.effectiveness] < LEVEL_ORDER[sorted[i - 1].effectiveness]
    ) {
      throw new Error(
        `Card ${card.id} is ranked behind a card with a lower effectiveness`
      );
    }
    if (card.basedOn === card.id) {
      throw new Error(`Card ${card.id} cannot be based on itself`);
    }
    if (card.basedOn && !ids.has(card.basedOn)) {
      throw new Error(
        `Card ${card.id} is based on unknown card ${card.basedOn}`
      );
    }
    for (const code of EXAMPLE_OCCUPATIONS) {
      const foreign = findMarkers(card.examples[code], otherOccupation(code));
      if (foreign.length > 0) {
        throw new Error(
          `Card ${card.id}: the ${code} example contains words of the other occupation (${foreign.join(', ')})`
        );
      }
    }
  });
}
