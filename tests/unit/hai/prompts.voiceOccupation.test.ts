/**
 * @jest-environment node
 */
import { resolveHaiPersona } from '@/lib/hai/persona';
import * as prompts from '@/lib/hai/prompts';
import { FIAE_CATALOG, KFBM_CATALOG } from './fixtures/kfbmPersona';
import voiceSectionPr295 from './fixtures/voice-section-pr295.json';

// The spoken way against the typed way (docs/hai-golden-set.md, 5e). The golden
// set measured EX-16 (a trainee with two occupations asks which database stores
// the travel costs and the hotel bookings) spoken: "gehört nicht zu deiner
// Ausbildung" in 2 of 2 runs, typed it passed. The voice section was the only
// difference of the prompt, and it named "andere Berufe" as forbidden. These
// tests hold what must stay the same in both ways and that nothing in the voice
// section contradicts it.

const both = (role: 'TRAINEE' | 'TRAINER') =>
  resolveHaiPersona({
    catalogs: [FIAE_CATALOG, KFBM_CATALOG],
    otherCatalogs: [],
    role,
  });

const build = (voice: boolean, role: 'TRAINEE' | 'TRAINER') =>
  prompts.buildSystemPrompt({
    mode: 'general',
    persona: both(role),
    userRole: role,
    voice,
  });

describe('the spoken prompt holds the same occupation limits as the typed one', () => {
  it.each(['TRAINEE', 'TRAINER'] as const)(
    'the typed prompt is contained in the spoken one, whole (%s)',
    role => {
      const spoken = build(true, role);
      const typed = build(false, role);
      // the persona of this test has two occupations: the voice section has the
      // line for several occupations
      expect(
        spoken.replace(`${prompts.buildVoiceRules(role, true)}\n\n`, '')
      ).toBe(typed);
    }
  );

  it.each(['TRAINEE', 'TRAINER'] as const)(
    'both ways carry the topic check, the sentence for several occupations and the refusal sentence (%s)',
    role => {
      for (const prompt of [build(false, role), build(true, role)]) {
        expect(prompt).toContain('**Themenprüfung:**');
        expect(prompt).toContain(
          'Hat die Person mehrere Berufe, gehören die Inhalte aller ihrer Berufe dazu.'
        );
        // the refusal stays (for several occupations: of an occupation the
        // person does not have)
        expect(prompt).toContain('den die Person NICHT hat');
        expect(prompt).toContain(
          'Dazu kann ich dir hier leider nichts sagen, denn das gehört nicht zu deiner Ausbildung.'
        );
      }
    }
  );

  it.each(['TRAINEE', 'TRAINER', undefined] as const)(
    'the voice section does not forbid occupations by itself and sends to the topic check (%s)',
    role => {
      const rules = prompts.buildVoiceRules(role);
      // the old sentence that primed the model to refuse questions of an own occupation
      expect(rules).not.toMatch(/verbieten \(andere Berufe/);
      expect(rules).not.toMatch(/andere Berufe, Musterlösungen/);
      expect(rules).toContain(prompts.VOICE_OCCUPATION_LINE);
      expect(prompts.VOICE_OCCUPATION_LINE).toContain('Themenprüfung');
      // answers a question of an own occupation, also with an everyday word, and
      // with several occupations the content of all of them
      expect(prompts.VOICE_OCCUPATION_LINE).toMatch(
        /beantwortest du auch gesprochen fachlich, auch mit einem Alltagswort/
      );
      expect(prompts.VOICE_OCCUPATION_LINE).toMatch(
        /mehrere Berufe, gehören die Inhalte aller ihrer Berufe dazu/
      );
    }
  );

  it('the refusal of another occupation is not weakened: same sentence, no counter question about an entry of it', () => {
    const line = prompts.VOICE_OCCUPATION_LINE;
    expect(line).toMatch(/Gehört der Inhalt zu einem anderen Ausbildungsberuf/);
    expect(line).toMatch(/antwortest du mit dem Satz aus der Themenprüfung/);
    expect(line).toMatch(/nie den Eintrag eines anderen Berufs/);
  });

  it('the solution ban of the trainee stays in the voice section and in the rules after it', () => {
    const rules = prompts.buildVoiceRules('TRAINEE');
    expect(rules).toMatch(/Musterlösungen, Lösungswege, Lernhinweise/);
    const prompt = build(true, 'TRAINEE');
    expect(prompt.lastIndexOf('gibst du an Azubis nie heraus')).toBeGreaterThan(
      prompt.indexOf('## Sprachassistent (Tagesbegleiter)')
    );
  });

  it('every sentence of the voice section that names a refusal points to the topic check or the rules after it', () => {
    const rules = prompts.buildVoiceRules('TRAINEE');
    const refusing = rules
      .split('\n')
      .filter(line => /ablehn|Dazu kann ich dir/.test(line));
    for (const line of refusing) {
      expect(line).toMatch(/Themenprüfung|Zusatzregeln|Lehne das nicht ab/);
    }
  });

  it('the line for several occupations says that a question joining two own occupations, or an own topic without the exact answer in the context, is no refusal', () => {
    const line = prompts.VOICE_MULTI_OCCUPATION_LINE;
    expect(line).toContain(
      'verbindet (zum Beispiel eine Datenbank für Reisekosten)'
    );
    expect(line).toMatch(/keine Frage eines anderen Berufs/);
    expect(line).toMatch(/Gehört die Frage zu deinen Berufen/);
    expect(line).toMatch(/keine Ablehnung/);
  });
});

describe('the persona of several occupations names them (the topic check uses it)', () => {
  it('names both, and a single occupation has no list (its prompt stays as it was)', () => {
    const two = both('TRAINEE');
    expect(two.occupationNames).toHaveLength(2);
    const one = resolveHaiPersona({
      catalogs: [FIAE_CATALOG],
      otherCatalogs: [KFBM_CATALOG],
      role: 'TRAINEE',
    });
    expect(one.occupationNames).toBeUndefined();
  });
});

// The sentence "answer from the knowledge when the context has no exact answer"
// belongs to persons with SEVERAL occupations only. Measured against preview
// 0ec2a1e6 with 6 runs each (spoken): OS-20 6 of 6 before, 2 of 6 with the
// sentence for everybody, OS-29 6 of 6 before, 4 of 6. Both are a trainer with ONE
// occupation who asks for a title of the other one and got a counter question
// "Meinst du den Use Case ...?" instead of the refusal. The voice section of one
// occupation stays byte for byte as it was in PR 295 (fixture, taken from the code
// of preview 0ec2a1e6).
describe('the voice section of ONE occupation is the one of PR 295, byte for byte', () => {
  it.each([
    ['TRAINEE', 'TRAINEE'],
    ['TRAINER', 'TRAINER'],
    [undefined, 'NONE'],
  ] as const)('buildVoiceRules(%s)', (role, key) => {
    expect(prompts.buildVoiceRules(role)).toBe(voiceSectionPr295[key]);
    expect(prompts.buildVoiceRules(role, false)).toBe(voiceSectionPr295[key]);
  });

  it.each(['TRAINEE', 'TRAINER'] as const)(
    'the spoken prompt of one occupation (FIAE and KfBM) holds exactly that section (%s)',
    role => {
      for (const catalog of [FIAE_CATALOG, KFBM_CATALOG]) {
        const persona = resolveHaiPersona({
          catalogs: [catalog],
          otherCatalogs: [],
          role,
        });
        expect(persona.occupationNames).toBeUndefined();
        const spoken = prompts.buildSystemPrompt({
          mode: 'general',
          persona,
          userRole: role,
          voice: true,
        });
        expect(spoken).toContain(voiceSectionPr295[role]);
        expect(spoken).not.toContain(prompts.VOICE_MULTI_OCCUPATION_LINE);
      }
    }
  );

  it.each(['TRAINEE', 'TRAINER'] as const)(
    'several occupations get the same section plus the one line for them (%s)',
    role => {
      const withLine = prompts.buildVoiceRules(role, true);
      expect(withLine).toContain(prompts.VOICE_MULTI_OCCUPATION_LINE);
      expect(
        withLine.replace(`${prompts.VOICE_MULTI_OCCUPATION_LINE}\n`, '')
      ).toBe(voiceSectionPr295[role]);
      const spoken = prompts.buildSystemPrompt({
        mode: 'general',
        persona: both(role),
        userRole: role,
        voice: true,
      });
      expect(spoken).toContain(prompts.VOICE_MULTI_OCCUPATION_LINE);
    }
  );

  it('the section of one occupation names a title only as an entry of the context and never offers an entry of another occupation', () => {
    // (the finding on counter questions: the base line already forbids it, the
    // question "Meinst du ...?" itself comes from the solution scope rules that
    // hold for both ways and are not changed here)
    const line = prompts.VOICE_OCCUPATION_LINE;
    expect(line).toContain('nennt nur Einträge, die in deinem Kontext stehen');
    expect(line).toContain('nie den Eintrag eines anderen Berufs');
    expect(line).not.toContain('Antworte kurz aus dem Fachwissen');
  });
});
