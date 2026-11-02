/**
 * @jest-environment node
 */

// loadHaiPersona (package H3): the persona comes from the catalogs of the
// access and the database, fail closed to the neutral persona.

const mockRows = jest.fn();

jest.mock('@/db', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => mockRows();
  return { __esModule: true, default: chain };
});
jest.mock('@/lib/db-retry', () => ({
  withDbRetry: (fn: () => unknown) => fn(),
}));

import { loadHaiPersona } from '@/lib/hai/personaAccess';
import {
  FIAE_PERSONA,
  NEUTRAL_PERSONA,
  isForeignOccupationQuestion,
  unselectedOccupationNamed,
} from '@/lib/hai/persona';
import { FIAE_CATALOG, KFBM_CATALOG } from './fixtures/kfbmPersona';

const access = (
  catalogIds: string[],
  audience: 'trainee' | 'trainer' = 'trainee'
) => ({ catalogIds, audience, organizationId: null, userId: 'u1' });

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.mockResolvedValue([FIAE_CATALOG, KFBM_CATALOG]);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('loadHaiPersona', () => {
  it('is neutral without an access or without catalogs', async () => {
    expect(await loadHaiPersona(null)).toBe(NEUTRAL_PERSONA);
    expect(await loadHaiPersona(access([]))).toBe(NEUTRAL_PERSONA);
    expect(mockRows).not.toHaveBeenCalled();
  });

  it('gives a FIAE trainee the FIAE texts and the KfBM names as foreign', async () => {
    const persona = await loadHaiPersona(access([FIAE_CATALOG.id]));
    expect(persona.refusalText).toBe(FIAE_PERSONA.refusalText);
    expect(persona.foreignMarkers).toEqual(
      expect.arrayContaining(['kfbm', 'büromanagement'])
    );
  });

  it('gives a KfBM trainee the settings texts and the phase of the server', async () => {
    const persona = await loadHaiPersona(access([KFBM_CATALOG.id]), {
      currentPhase: 2,
    });
    expect(persona.source).toBe('catalog-settings');
    expect(persona.examModeTitle).toContain('Teil 2');
    expect(persona.showTrainerTopics).toBe(false);
    expect(persona.foreignMarkers).toEqual(
      expect.arrayContaining(['fiae', 'fachinformatik'])
    );
  });

  it('takes the role from the audience, the phase only for trainees', async () => {
    const persona = await loadHaiPersona(access([KFBM_CATALOG.id], 'trainer'), {
      currentPhase: 1,
    });
    expect(persona.showTrainerTopics).toBe(true);
    expect(persona.examModeTitle).not.toContain('Teil 1');
  });

  it('without a choice the persona speaks about all occupations of the user (merged)', async () => {
    const both = access([KFBM_CATALOG.id, FIAE_CATALOG.id]);
    const merged = await loadHaiPersona(both);
    expect(merged.occupationName).toContain('Büromanagement');
    expect(merged.occupationName).toContain('Fachinformatik');
    expect(merged.unselectedOwn).toEqual([]);
    expect(merged.chosenLabel).toBeNull();
  });

  it('FIAE chosen: the persona of FIAE alone, a KfBM question is the answer "switch the tab"', async () => {
    const both = access([KFBM_CATALOG.id, FIAE_CATALOG.id]);
    const fiae = await loadHaiPersona(both, undefined, 'fiae');
    expect(fiae.source).toBe('fiae-default');
    expect(fiae.occupationName).toBe('Fachinformatik');
    expect(fiae.chosenLabel).toBe('FIAE');
    expect(fiae.unselectedOwn.map(u => u.name)).toEqual(['KfBM']);
    expect(
      unselectedOccupationNamed('Erkläre KfBM Lernfeld 3', fiae)?.name
    ).toBe('KfBM');
    expect(isForeignOccupationQuestion('Erkläre KfBM Lernfeld 3', fiae)).toBe(
      false
    );
  });

  it('KfBM chosen (any case, with blanks): the persona of KfBM alone, a FIAE question is "switch the tab"', async () => {
    const both = access([FIAE_CATALOG.id, KFBM_CATALOG.id]);
    const kfbm = await loadHaiPersona(both, undefined, ' KfBM ');
    expect(kfbm.source).toBe('catalog-settings');
    expect(kfbm.occupationName).toBe('Kaufleute für Büromanagement');
    expect(kfbm.chosenLabel).toBe('KfBM');
    expect(kfbm.unselectedOwn.map(u => u.name)).toEqual(['FIAE']);
    expect(
      unselectedOccupationNamed('Wie funktioniert Fachinformatik?', kfbm)?.name
    ).toBe('FIAE');
  });

  it('follows the access that the choice already narrowed: the other own occupation is unselected', async () => {
    // resolveRetrievalAccess hands over one catalog and the full list next to it
    const narrowed = {
      ...access([FIAE_CATALOG.id]),
      allowedCatalogIds: [FIAE_CATALOG.id, KFBM_CATALOG.id],
    };
    const persona = await loadHaiPersona(narrowed);
    expect(persona.occupationName).toBe('Fachinformatik');
    expect(persona.unselectedOwn.map(u => u.name)).toEqual(['KfBM']);
    expect(persona.foreignMarkers).not.toContain('kfbm');
  });

  it('ignores a chosen code that is not one of the occupations of the user: no right is gained, nothing is lost', async () => {
    // KfBM only, "FIAE" chosen: still the KfBM persona, nothing of FIAE
    const only = await loadHaiPersona(
      access([KFBM_CATALOG.id]),
      undefined,
      'FIAE'
    );
    expect(only.source).toBe('catalog-settings');
    expect(only.occupationName).toBe('Kaufleute für Büromanagement');
    expect(only.unselectedOwn).toEqual([]);
    expect(isForeignOccupationQuestion('Erkläre FIAE Lernfeld 6', only)).toBe(
      true
    );
    // both occupations, an unknown code: merged as without a choice
    const both = await loadHaiPersona(
      access([KFBM_CATALOG.id, FIAE_CATALOG.id]),
      undefined,
      'unknown'
    );
    expect(both.occupationName).toContain('Büromanagement');
    expect(both.occupationName).toContain('Fachinformatik');
    expect(both.unselectedOwn).toEqual([]);
  });

  it('a user with FIAE only gets the same persona with and without the code', async () => {
    const plain = await loadHaiPersona(access([FIAE_CATALOG.id]));
    const chosen = await loadHaiPersona(
      access([FIAE_CATALOG.id]),
      undefined,
      'FIAE'
    );
    expect(chosen.refusalText).toBe(plain.refusalText);
    expect(chosen.refusalText).toBe(FIAE_PERSONA.refusalText);
    expect(chosen.unselectedOwn).toEqual([]);
    expect(chosen.chosenLabel).toBeNull();
  });

  it('is neutral when the catalogs of the access are unknown', async () => {
    expect(await loadHaiPersona(access(['unknown-id']))).toBe(NEUTRAL_PERSONA);
  });

  it('fails closed to the neutral persona on a database error', async () => {
    mockRows.mockRejectedValue(new Error('db down'));
    expect(await loadHaiPersona(access([FIAE_CATALOG.id]))).toBe(
      NEUTRAL_PERSONA
    );
  });
});
