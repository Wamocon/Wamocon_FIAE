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
import { FIAE_PERSONA, NEUTRAL_PERSONA } from '@/lib/hai/persona';
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
