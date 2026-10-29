/**
 * The planets of the learning universe on the landing page (public, no
 * session). The active ones are the occupations the platform serves today
 * (FIAE and KfBM), the others are announced. Pure data, so the canvas and the
 * tests share it.
 *
 * Only FIAE can be opened: the landing page carries the learning fields of the
 * FIAE training, not those of other occupations.
 */

export interface UniversePlanetDef {
  abbr: string;
  orbitR0: number;
  r0: number;
  speed: number;
  angle: number;
  active: boolean;
}

export const UNIVERSE_PLANETS: readonly UniversePlanetDef[] = [
  {
    abbr: 'FIAE',
    orbitR0: 115,
    r0: 26,
    speed: 0.00035,
    angle: Math.PI * 0.25,
    active: true,
  },
  {
    abbr: 'KfBM',
    orbitR0: 175,
    r0: 24,
    speed: 0.00027,
    angle: Math.PI * 1.25,
    active: true,
  },
  {
    abbr: 'FISI',
    orbitR0: 235,
    r0: 22,
    speed: 0.00022,
    angle: Math.PI * 1.6,
    active: false,
  },
  {
    abbr: 'IT-Kfm',
    orbitR0: 290,
    r0: 20,
    speed: 0.00016,
    angle: Math.PI * 0.9,
    active: false,
  },
  {
    abbr: 'IT-Sys',
    orbitR0: 340,
    r0: 20,
    speed: 0.00011,
    angle: Math.PI * 2.4,
    active: false,
  },
];

/** The planet opens the learning fields when clicked (only FIAE). */
export function isExplorable(planet: Pick<UniversePlanetDef, 'abbr'>) {
  return planet.abbr === 'FIAE';
}

const NAME_KEYS: Record<string, string> = {
  FIAE: 'landing.universe.planet.fiae',
  KfBM: 'landing.universe.planet.kfbm',
  FISI: 'landing.universe.planet.fisi',
  'IT-Kfm': 'landing.universe.planet.itkfm',
  'IT-Sys': 'landing.universe.planet.itsys',
};

/** Translation keys of the tooltip of a planet. */
export function describeUniversePlanet(
  planet: Pick<UniversePlanetDef, 'abbr' | 'active'>
): { nameKey: string; subKey: string } {
  const nameKey = NAME_KEYS[planet.abbr];
  if (planet.active) return { nameKey, subKey: `${nameKey}.sub` };
  return { nameKey, subKey: 'landing.universe.planet.soon' };
}
