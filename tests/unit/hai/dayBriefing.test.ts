/**
 * @jest-environment node
 */
// Day companion (WMCNL-2907): the data intent "day_briefing" and the folding of
// umlauts that a spoken or typed message needs to meet the keyword lists.

jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/auth-helpers', () => ({ toHaiRole: jest.fn() }));
jest.mock('@/lib/catalog/scope', () => ({
  getCatalogScopeForUserId: jest.fn(),
}));
jest.mock('@/lib/catalog/phase-plan-db', () => ({ loadPhasePlan: jest.fn() }));

import { classifyDataIntent, foldUmlauts } from '@/lib/hai/dataContext';

describe('foldUmlauts', () => {
  it('lower-cases and writes umlauts the way the keyword lists do', () => {
    expect(foldUmlauts('Wann ist meine PRÜFUNG, nächste Woche? Größe')).toBe(
      'wann ist meine pruefung, naechste woche? groesse'
    );
  });
});

describe('the day companion intent', () => {
  it.each([
    'Guten Morgen!',
    'Was steht heute an?',
    'Was steht heute an',
    'Kannst du meinen Tag planen?',
    'Mach mir einen Tagesplan',
    'Was ist heute wichtig?',
    'Was muss ich heute erledigen?',
    'Was ist dringend?',
  ])('recognizes "%s" for a trainee', message => {
    expect(classifyDataIntent(message, 'TRAINEE')).toBe('day_briefing');
  });

  it('recognizes the same for a trainer, before the review list of the trainers', () => {
    // "was muss ich" alone is the review intent of a trainer; with "heute" it is the day
    expect(classifyDataIntent('Was muss ich heute erledigen?', 'TRAINER')).toBe(
      'day_briefing'
    );
    expect(classifyDataIntent('Was muss ich bewerten?', 'TRAINER')).toBe(
      'review_query'
    );
  });

  it('leaves the other intents as they were', () => {
    expect(classifyDataIntent('Wie ist mein Fortschritt?', 'TRAINEE')).toBe(
      'progress_query'
    );
    expect(classifyDataIntent('Wann habe ich Berufsschule?', 'TRAINEE')).toBe(
      'calendar_query'
    );
    expect(classifyDataIntent('Was ist ein Primärschlüssel?', 'TRAINEE')).toBe(
      'none'
    );
  });

  it('meets its own keywords with and without umlauts (spoken text has them)', () => {
    expect(classifyDataIntent('Plan für heute bitte', 'TRAINEE')).toBe(
      'day_briefing'
    );
    expect(classifyDataIntent('Plan fuer heute bitte', 'TRAINEE')).toBe(
      'day_briefing'
    );
    expect(classifyDataIntent('Tagesüberblick', 'TRAINEE')).toBe(
      'day_briefing'
    );
  });

  it('keeps a learning question with the word Prüfung a learning question', () => {
    expect(
      classifyDataIntent('Wie lerne ich am besten für die Prüfung?', 'TRAINEE')
    ).toBe('learning_query');
  });
});
