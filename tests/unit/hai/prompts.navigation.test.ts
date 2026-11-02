/**
 * @jest-environment node
 */
import { buildNavigationRules, buildSystemPrompt } from '@/lib/hai/prompts';

// The prompt tells the model that the platform offers the navigation cards
// itself and that it invents no link or path. The section is only there when the
// pipeline sets the flag, so the prompt of FIAE stays as it was without it
// (persona.fiae-baseline.test.ts).

describe('the guidance section of the prompt', () => {
  const SECTION = '## Führung durch die Plattform';

  it('is not part of the prompt without the flag', () => {
    expect(buildSystemPrompt({ mode: 'general' })).not.toContain(SECTION);
    expect(
      buildSystemPrompt({ mode: 'general', userRole: 'TRAINEE', voice: true })
    ).not.toContain(SECTION);
  });

  it('is part of the prompt with the flag, for both roles and spoken or typed', () => {
    for (const userRole of ['TRAINEE', 'TRAINER'] as const) {
      for (const voice of [false, true]) {
        const prompt = buildSystemPrompt({
          mode: 'general',
          userRole,
          voice,
          navigation: true,
        });
        expect(prompt).toContain(SECTION);
        expect(prompt).toContain(buildNavigationRules());
      }
    }
  });

  it('keeps the borderline rules as the last word', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      userRole: 'TRAINEE',
      voice: true,
      navigation: true,
    });
    expect(prompt.indexOf(SECTION)).toBeLessThan(
      prompt.indexOf('## Zusatzregeln für Grenzfälle')
    );
  });

  it('says that the platform offers the card and that no link or path is invented', () => {
    const text = buildNavigationRules();
    expect(text).toContain('bietet die Plattform selbst eine Karte');
    expect(text).toContain('Erfinde keine Links, Pfade oder Adressen');
    expect(text).toContain('Du öffnest keine Seiten und füllst nichts aus');
    // no dash used as a separator in the text
    expect(text).not.toMatch(/[–—]/);
  });
});
