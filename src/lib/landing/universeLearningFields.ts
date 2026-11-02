/**
 * The learning fields that the planets of the learning universe open on the
 * landing page (public, no session). The FIAE fields stay in the page itself
 * (names from the translations, counts of components and use cases). The KfBM
 * ones are the 13 official learning fields of the framework curriculum, the
 * same data the KfBM import writes (src/lib/content-import/learning-fields).
 * The page has no counts of components and use cases for KfBM, so those stay 0
 * and the canvas draws no inner rings for them. Pure data and layout, so the
 * canvas and the tests share it.
 */

import { OFFICIAL_LEARNING_FIELDS } from '@/lib/content-import/learning-fields/official';

export interface UniverseLearningFieldDef {
  id: number;
  short: string;
  /** Translation key of the name (FIAE) */
  nameKey?: string;
  /** Plain name (KfBM: the official title) */
  name?: string;
  /** Components and use cases around the field, 0 when the page has none */
  komps: number;
  uc: number;
  /** KfBM: "Zeitrichtwert" in hours and the school year */
  hours?: number;
  year?: number;
}

/** The 13 learning fields of the KfBM with their official titles. */
export const KFBM_UNIVERSE_FIELDS: readonly UniverseLearningFieldDef[] =
  OFFICIAL_LEARNING_FIELDS.map(lf => ({
    id: lf.number,
    short: `LF${lf.number}`,
    name: lf.title,
    komps: 0,
    uc: 0,
    hours: lf.hours,
    year: lf.trainingYear,
  }));

/** Number of the rings the fields are spread on (around the centre). */
export const UNIVERSE_RINGS = 3;

/**
 * The ring and the start angle of every field. The fields are spread evenly
 * over three rings, a ring that has to take the rest gets the further ones
 * (12 fields: 4, 4, 4 as before, 13 fields: 4, 4, 5).
 */
export function layoutUniverseFields(
  count: number
): Array<{ ring: number; angle: number }> {
  const base = Math.floor(count / UNIVERSE_RINGS);
  const rest = count % UNIVERSE_RINGS;
  const result: Array<{ ring: number; angle: number }> = [];
  for (let ring = 0; ring < UNIVERSE_RINGS; ring++) {
    const size = base + (ring >= UNIVERSE_RINGS - rest ? 1 : 0);
    for (let k = 0; k < size; k++) {
      result.push({
        ring,
        angle: ((Math.PI * 2) / size) * k + ring * 0.5 + 0.3,
      });
    }
  }
  return result;
}
