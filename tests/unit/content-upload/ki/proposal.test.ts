/**
 * @jest-environment node
 */
import { CONFIDENCE } from '@/lib/content-upload/classify/types';
import type { KiAnswer } from '@/lib/content-upload/ki/answer';
import {
  MEDIUM_FROM,
  contradictions,
  deriveProposal,
} from '@/lib/content-upload/ki/proposal';
import type { ProposalRecord } from '@/lib/content-upload/review/types';

const answer = (overrides: Partial<KiAnswer> = {}): KiAnswer => ({
  docType: 'quiz',
  componentCode: 'K1',
  enablerCode: 'K1-a',
  quizLevel: 'low',
  confidence: 0.7,
  reason: 'Die Überschrift nennt ein Quiz.',
  ...overrides,
});

const rule = (overrides: Partial<ProposalRecord> = {}): ProposalRecord => ({
  id: 'p1',
  fileId: 'f1',
  source: 'content',
  docType: null,
  componentCode: null,
  enablerCode: null,
  quizLevel: null,
  confidence: 0,
  band: 'low',
  reasons: [{ code: 'NO_TYPE', text: 'Es wurde kein Typ erkannt.' }],
  model: null,
  createdAt: new Date(0),
  ...overrides,
});

describe('from the answer of the model to a proposal', () => {
  it('makes a proposal with the source ki, a band of medium at best and the cap on the confidence', () => {
    const outcome = deriveProposal(answer(), rule(), 'test-model');
    expect(outcome.kind).toBe('proposal');
    if (outcome.kind !== 'proposal') return;
    expect(outcome.write).toMatchObject({
      source: 'ki',
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-a',
      quizLevel: 'low',
      confidence: 0.7,
      band: 'medium',
      model: 'test-model',
    });
    expect(outcome.write.reasons[0]).toEqual({
      code: 'KI_PROPOSAL',
      text: 'Vorschlag von Sokrates: Die Überschrift nennt ein Quiz.',
    });
  });

  it('never says high, however sure the model is', () => {
    for (const confidence of [0, 0.5, 0.8, 1]) {
      const outcome = deriveProposal(answer({ confidence }), rule(), 'm');
      expect(outcome.kind).toBe('proposal');
      if (outcome.kind === 'proposal') {
        expect(outcome.write.band).not.toBe('high');
        expect(['medium', 'low']).toContain(outcome.write.band);
      }
    }
  });

  it('is only medium for a complete assignment with enough confidence', () => {
    const band = (a: Partial<KiAnswer>) => {
      const o = deriveProposal(answer(a), rule(), 'm');
      return o.kind === 'proposal' ? o.write.band : o.kind;
    };
    expect(band({ confidence: MEDIUM_FROM })).toBe('medium');
    expect(band({ confidence: MEDIUM_FROM - 0.01 })).toBe('low');
    expect(band({ enablerCode: null })).toBe('low');
    expect(band({ quizLevel: null })).toBe('low');
    expect(band({ componentCode: null, enablerCode: null })).toBe('low');
    expect(
      band({ docType: 'global_quiz', enablerCode: null, quizLevel: null })
    ).toBe('medium');
    expect(band({ docType: 'scenario', quizLevel: null })).toBe('medium');
  });

  it('says there is no result when the model named nothing', () => {
    expect(
      deriveProposal(
        answer({
          docType: null,
          componentCode: null,
          enablerCode: null,
          quizLevel: null,
          confidence: 0,
        }),
        rule(),
        'm'
      )
    ).toEqual({ kind: 'no_result' });
  });

  it('fills what the rules left open and keeps what they had', () => {
    const outcome = deriveProposal(
      answer({ componentCode: 'K1', enablerCode: null, quizLevel: null }),
      rule({ docType: 'quiz', enablerCode: 'K1-b', quizLevel: 'medium' }),
      'm'
    );
    expect(outcome.kind).toBe('proposal');
    if (outcome.kind !== 'proposal') return;
    expect(outcome.write).toMatchObject({
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-b',
      quizLevel: 'medium',
    });
  });

  it('keeps every reason of the rules, so a person is still asked to name the assignment', () => {
    const outcome = deriveProposal(
      answer(),
      rule({
        reasons: [
          { code: 'SOLUTION_MARKER', text: 'Ein Markenwort.' },
          { code: 'INPUT_TRUNCATED', text: 'Gekürzt.' },
        ],
      }),
      'm'
    );
    expect(outcome.kind).toBe('proposal');
    if (outcome.kind !== 'proposal') return;
    expect(outcome.write.reasons.map(r => r.code)).toEqual([
      'KI_PROPOSAL',
      'SOLUTION_MARKER',
      'INPUT_TRUNCATED',
    ]);
  });

  it('cuts the number of reasons and the length of their text', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      code: `R${i}`,
      text: 'x',
    }));
    const outcome = deriveProposal(
      answer({ reason: 'y'.repeat(190) }),
      rule({ reasons: many }),
      'm'
    );
    expect(outcome.kind).toBe('proposal');
    if (outcome.kind !== 'proposal') return;
    expect(outcome.write.reasons).toHaveLength(10);
    for (const r of outcome.write.reasons) {
      expect(r.text.length).toBeLessThanOrEqual(200);
    }
  });

  describe('a contradiction of the rules', () => {
    it('stays a conflict: the values of the rules stay, the model never overwrites them', () => {
      const outcome = deriveProposal(
        answer({
          docType: 'scenario',
          componentCode: 'K6.1',
          enablerCode: 'K6.1-a',
        }),
        rule({
          source: 'path',
          docType: 'quiz',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: 'low',
          band: 'low',
          confidence: 0.5,
        }),
        'm'
      );
      expect(outcome.kind).toBe('conflict');
      if (outcome.kind !== 'conflict') return;
      expect(outcome.write).toMatchObject({
        source: 'path',
        docType: 'quiz',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: 'low',
        band: 'conflict',
        confidence: CONFIDENCE.conflict,
        model: null,
      });
      expect(outcome.write.reasons[0].code).toBe('KI_CONTRADICTS');
      // the text names the codes of the proposal, no text of the model
      expect(outcome.write.reasons[0].text).toContain('K6.1');
    });

    it.each([
      ['type', { docType: 'scenario' as const }, { docType: 'quiz' }],
      ['component', { componentCode: 'K9' }, { componentCode: 'K1' }],
      ['enabler', { enablerCode: 'K1-b' }, { enablerCode: 'K1-a' }],
      ['level', { quizLevel: 'high' as const }, { quizLevel: 'low' }],
    ])('is raised by a different %s', (_name, kiFields, ruleFields) => {
      expect(deriveProposal(answer(kiFields), rule(ruleFields), 'm').kind).toBe(
        'conflict'
      );
    });

    it('does not shrink to a proposal when the model repeats the reason of the rules', () => {
      // a rule source of "ki" cannot happen, but the source of a conflict is never ki
      const outcome = deriveProposal(
        answer({ docType: 'scenario' }),
        rule({ source: 'ki' as never, docType: 'quiz' }),
        'm'
      );
      expect(outcome.kind).toBe('conflict');
      if (outcome.kind === 'conflict') {
        expect(outcome.write.source).not.toBe('ki');
      }
    });

    it('is no conflict when the values agree or one side is empty', () => {
      expect(
        contradictions(
          {
            docType: 'quiz',
            componentCode: null,
            enablerCode: null,
            quizLevel: null,
          },
          {
            docType: 'quiz',
            componentCode: 'K1',
            enablerCode: null,
            quizLevel: null,
          }
        )
      ).toEqual([]);
    });
  });
});
