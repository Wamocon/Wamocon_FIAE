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
        expect(prompt).toContain(buildNavigationRules(userRole));
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
    expect(text).toContain('Du klickst nichts an und füllst nichts aus');
    // no dash used as a separator in the text
    expect(text).not.toMatch(/[–—]/);
  });
});

// Report of the client: the model said "ich habe keine Berechtigung, aktiv durch
// die Menüs zu navigieren" and named an invented menu entry ("Auszubildenden-
// Übersicht auf deinem Dashboard"). The platform opens pages, so the prompt
// forbids both and names the real menu entries of the role.
describe('the guidance section: no "no permission", real menu names', () => {
  const sectionOf = (userRole?: 'TRAINER' | 'TRAINEE') =>
    buildNavigationRules(userRole);

  it('never lets the model say it has no permission or cannot open pages', () => {
    for (const role of ['TRAINER', 'TRAINEE', undefined] as const) {
      const text = sectionOf(role);
      expect(text).toContain(
        'Sage nie, du hättest keine Berechtigung, Seiten zu öffnen'
      );
      expect(text).toContain('sage nie, du könntest das nicht');
      expect(text).toContain(
        'Die Plattform öffnet die Seite, sobald die Person sie beim Namen nennt'
      );
      expect(text).toContain('oder die Karte antippt');
      // the old sentence that told the model it does not open pages is gone
      expect(text).not.toContain('Du öffnest keine Seiten');
      // no sentence that claims a missing right as a statement of the model
      expect(text).not.toMatch(/(?:habe|hast) (?:ich|du) keine Berechtigung/);
    }
  });

  it('names the real menu entries of a trainer, not an invented one', () => {
    const text = sectionOf('TRAINER');
    expect(text).toContain(
      'Dashboard, Ausbildungsnachweis, Berufsschule, Inhaltsverwaltung, Quiz-Übersicht, Auszubildende, Profil'
    );
    expect(text).toContain('Öffne die Auszubildenden');
    expect(text).toContain('sage nie "auf deinem Dashboard"');
    expect(text).not.toContain('Auszubildenden-Übersicht');
    expect(text).not.toContain('Lernen,');
  });

  it('names the real menu entries of a trainee, and the strict list without a role', () => {
    const trainee = sectionOf('TRAINEE');
    expect(trainee).toContain(
      'Dashboard, Ausbildungsnachweis, Berufsschule, Lernen, Ausbilder-Feedback, Quizze, Profil'
    );
    expect(trainee).not.toContain('Auszubildende,');
    expect(trainee).not.toContain('Inhaltsverwaltung');
    expect(sectionOf(undefined)).toBe(trainee);
  });

  it('is short and has no dash as separator', () => {
    for (const role of ['TRAINER', 'TRAINEE'] as const) {
      const text = sectionOf(role);
      expect(text.length).toBeLessThan(1500);
      expect(text).not.toMatch(/[–—]/);
    }
  });

  it('is part of the prompt of the typed and of the spoken path, with the role', () => {
    for (const voice of [false, true]) {
      const prompt = buildSystemPrompt({
        mode: 'general',
        userRole: 'TRAINER',
        voice,
        navigation: true,
      });
      expect(prompt).toContain('Auszubildende, Profil');
      expect(prompt).toContain('Sage nie, du hättest keine Berechtigung');
    }
  });

  it('leaves the protection rules as they are: the section only adds, the rest of the prompt is the same', () => {
    for (const userRole of ['TRAINER', 'TRAINEE'] as const) {
      const without = buildSystemPrompt({ mode: 'general', userRole });
      const withSection = buildSystemPrompt({
        mode: 'general',
        userRole,
        navigation: true,
      });
      expect(
        withSection.replace(
          `

${sectionOf(userRole)}`,
          ''
        )
      ).toBe(without);
      // the protection of the solutions and the borderline rules are there
      expect(withSection).toContain('## Was geschützt ist und was nicht');
      expect(withSection).toContain('## Zusatzregeln für Grenzfälle');
    }
  });
});
