import {
  UNIVERSE_PLANETS,
  describeUniversePlanet,
  isExplorable,
} from '@/lib/landing/universePlanets';

describe('universe planets', () => {
  it('shows FIAE and KfBM as active planets', () => {
    const active = UNIVERSE_PLANETS.filter(p => p.active).map(p => p.abbr);
    expect(active).toEqual(['FIAE', 'KfBM']);
  });

  it('keeps FIAE first, the canvas opens the learning fields with it', () => {
    expect(UNIVERSE_PLANETS[0].abbr).toBe('FIAE');
    expect(isExplorable(UNIVERSE_PLANETS[0])).toBe(true);
  });

  it('only FIAE can be explored, the page has no learning field data for KfBM', () => {
    const explorable = UNIVERSE_PLANETS.filter(isExplorable).map(p => p.abbr);
    expect(explorable).toEqual(['FIAE']);
  });

  it('uses distinct, ascending orbits and distinct abbreviations', () => {
    const orbits = UNIVERSE_PLANETS.map(p => p.orbitR0);
    expect(new Set(orbits).size).toBe(orbits.length);
    expect([...orbits].sort((a, b) => a - b)).toEqual(orbits);
    const abbrs = UNIVERSE_PLANETS.map(p => p.abbr);
    expect(new Set(abbrs).size).toBe(abbrs.length);
  });

  it('describes the planets with translation keys', () => {
    expect(describeUniversePlanet(UNIVERSE_PLANETS[0])).toEqual({
      nameKey: 'landing.universe.planet.fiae',
      subKey: 'landing.universe.planet.fiae.sub',
    });
    const kfbm = UNIVERSE_PLANETS.find(p => p.abbr === 'KfBM')!;
    expect(describeUniversePlanet(kfbm)).toEqual({
      nameKey: 'landing.universe.planet.kfbm',
      subKey: 'landing.universe.planet.kfbm.sub',
    });
    for (const p of UNIVERSE_PLANETS.filter(p => !p.active)) {
      expect(describeUniversePlanet(p).subKey).toBe(
        'landing.universe.planet.soon'
      );
    }
  });

  it('names an inactive planet with its own key', () => {
    const names = UNIVERSE_PLANETS.filter(p => !p.active).map(
      p => describeUniversePlanet(p).nameKey
    );
    expect(names).toEqual([
      'landing.universe.planet.fisi',
      'landing.universe.planet.itkfm',
      'landing.universe.planet.itsys',
    ]);
  });
});
