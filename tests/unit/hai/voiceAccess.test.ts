/**
 * @jest-environment node
 */
jest.mock('@/db', () => ({ __esModule: true, default: {} }));

import { voiceAllowed } from '@/lib/hai/voiceAccess';

// The switch of the voice assistant per organization (WMCNL-2907): only an active
// organization with the switch explicitly on; everything else is off.

describe('voiceAllowed', () => {
  it('allows an active organization with the switch on', () => {
    expect(voiceAllowed({ enabled: true, active: true })).toBe(true);
  });

  it.each([
    ['switch off', { enabled: false, active: true }],
    ['organization inactive', { enabled: true, active: false }],
    ['switch unknown', { enabled: null, active: true }],
    ['switch missing', { enabled: undefined, active: true }],
    ['activity unknown', { enabled: true, active: null }],
    ['both off', { enabled: false, active: false }],
  ])('refuses: %s', (_name, row) => {
    expect(voiceAllowed(row)).toBe(false);
  });

  it('fails closed without a row', () => {
    expect(voiceAllowed(undefined)).toBe(false);
  });

  it('does not treat a truthy non-boolean as on', () => {
    expect(
      voiceAllowed({ enabled: 'true' as unknown as boolean, active: true })
    ).toBe(false);
  });
});
