import { readFileSync } from 'fs';
import { join } from 'path';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

// WMCNL-2977 and WMCNL-2978: the section "Vom Chaos zur Ordnung" names KfBM
// next to FIAE, and the planet KfBM opens its learning fields.

const deTexts = de as Record<string, string>;
const enTexts = en as Record<string, string>;
const page = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');

describe('landing page: learning universe with both occupations', () => {
  it('names KfBM in the subtitle and in the hint of the section, next to FIAE', () => {
    expect(page).toMatch(
      /<strong[^>]*>FIAE<\/strong>\{' '\}\s*\{t\('landing\.universe\.or'\)\}\{' '\}\s*<strong[^>]*>KfBM<\/strong>/
    );
    expect(page).toMatch(
      /<span[^>]*>FIAE<\/span>\{' '\}\s*\{t\('landing\.universe\.or'\)\}\{' '\}\s*<span[^>]*>KfBM<\/span>/
    );
    expect(deTexts['landing.universe.or']).toBe('oder');
    expect(enTexts['landing.universe.or']).toBe('or');
  });

  it('opens the learning fields of the clicked explorable planet, not of FIAE only', () => {
    expect(page).toContain('KFBM_UNIVERSE_FIELDS');
    expect(page).toContain('st.lfSets[p.abbr]');
    expect(page).toContain('ctx.fillText(st.focus, st.cx, st.cy)');
    expect(page).not.toContain("ctx.fillText('FIAE', st.cx, st.cy)");
  });

  it('describes the KfBM planet with its 13 learning fields in both languages', () => {
    expect(deTexts['landing.universe.planet.kfbm.sub']).toContain('13');
    expect(enTexts['landing.universe.planet.kfbm.sub']).toContain('13');
    expect(deTexts['landing.universe.lfHours']).toContain('{hours}');
    expect(enTexts['landing.universe.lfHours']).toContain('{hours}');
  });

  it('does not state a count that only holds for one occupation without naming it', () => {
    for (const key of [
      'landing.universe.lernfeldSub',
      'landing.universe.komponenteSub',
      'landing.universe.useCaseSub',
    ]) {
      expect(deTexts[key]).toMatch(/FIAE/);
      expect(enTexts[key]).toMatch(/FIAE/);
    }
  });
});
