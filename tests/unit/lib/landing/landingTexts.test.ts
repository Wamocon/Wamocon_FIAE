import de from '@/locales/de.json';
import en from '@/locales/en.json';

const deTexts = de as Record<string, string>;
const enTexts = en as Record<string, string>;

// The landing page is for both occupations. These texts must name both or
// none, never only FIAE.
const OCCUPATION_NEUTRAL_KEYS = [
  'landing.hero.badge',
  'landing.faq.q1.a',
  'landing.footer.description',
  'landing.features.titleLine1',
  'landing.hero.trust1Sub',
  'landing.roles.trainer.row4.after',
  'hai.welcome.description',
  'landing.universe.comingSoon',
];

const NEW_KEYS = [
  'catalog.dashboard.occupation',
  'landing.universe.planet.fiae',
  'landing.universe.planet.fiae.sub',
  'landing.universe.planet.kfbm',
  'landing.universe.planet.kfbm.sub',
  'landing.universe.planet.fisi',
  'landing.universe.planet.itkfm',
  'landing.universe.planet.itsys',
  'landing.universe.planet.soon',
  'landing.universe.hint.pre',
  'landing.universe.hint.post',
];

describe('landing page texts for both occupations', () => {
  it.each([
    'landing.hero.badge',
    'landing.faq.q1.a',
    'landing.universe.comingSoon',
  ])('%s names FIAE and KfBM in de and en', key => {
    for (const texts of [deTexts, enTexts]) {
      expect(texts[key]).toMatch(/FIAE/);
      expect(texts[key]).toMatch(/KfBM/);
    }
  });

  it('answers "Für wen ist LFA geeignet?" with both occupations spelled out', () => {
    expect(deTexts['landing.faq.q1.a']).toContain(
      'Fachinformatiker für Anwendungsentwicklung'
    );
    expect(deTexts['landing.faq.q1.a']).toContain(
      'Kaufleute für Büromanagement'
    );
    expect(enTexts['landing.faq.q1.a']).toContain(
      'IT specialists for application development'
    );
    expect(enTexts['landing.faq.q1.a']).toContain('office management');
  });

  it.each(OCCUPATION_NEUTRAL_KEYS)(
    '%s is not limited to FIAE or to IT training',
    key => {
      for (const texts of [deTexts, enTexts]) {
        const text = texts[key];
        expect(text).toBeTruthy();
        if (/FIAE/.test(text)) expect(text).toMatch(/KfBM/);
        expect(text).not.toMatch(/FIAusbV|IT-Ausbildung|IT training/);
      }
    }
  );

  it.each(OCCUPATION_NEUTRAL_KEYS.concat(NEW_KEYS))(
    '%s uses no dash as punctuation',
    key => {
      for (const texts of [deTexts, enTexts]) {
        if (texts[key]) expect(texts[key]).not.toMatch(/ [—–-] |[—–]/);
      }
    }
  );

  it('writes the German texts with real umlauts', () => {
    for (const key of OCCUPATION_NEUTRAL_KEYS.concat(NEW_KEYS)) {
      expect(deTexts[key] ?? '').not.toMatch(/Buero|Prufung|fuer\b|ueber/i);
    }
  });

  it.each(NEW_KEYS)('%s exists in de and en', key => {
    expect(deTexts[key]).toBeTruthy();
    expect(enTexts[key]).toBeTruthy();
  });
});
