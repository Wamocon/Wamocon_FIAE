/**
 * @jest-environment node
 */
// Mandatory or elective, phase and visibility: derived from the component and
// the type with the presets of the import (concept 8.3), never chosen freely.
import { describe, expect, it } from '@jest/globals';

import {
  deriveComponentFacts,
  visibilityOf,
} from '@/lib/content-upload/classify/derive';

import { loadDecisions } from '../../../helpers/classifyFixtures';

const decisions = loadDecisions();

describe('deriveComponentFacts', () => {
  it('derives a mandatory component of part one with phase 1', () => {
    expect(deriveComponentFacts(decisions, 'K1', 'teil1')).toEqual({
      number: 1,
      kind: 'pflicht',
      phase: 1,
      group: 'teil1',
      excluded: false,
      issues: [],
    });
  });

  it('derives a split mandatory component of part two with phase 2', () => {
    expect(deriveComponentFacts(decisions, 'K6.2', 'teil2')).toMatchObject({
      kind: 'pflicht',
      phase: 2,
      group: 'teil2',
      issues: [],
    });
    expect(deriveComponentFacts(decisions, 'K24.1', 'teil1').phase).toBe(1);
    expect(deriveComponentFacts(decisions, 'K25.2', 'teil2').phase).toBe(2);
  });

  it('derives an elective component and an integrative one without a phase', () => {
    expect(deriveComponentFacts(decisions, 'K12', 'wahl')).toMatchObject({
      kind: 'wahl',
      phase: null,
      issues: [],
    });
    expect(deriveComponentFacts(decisions, 'K20', 'ganze')).toMatchObject({
      kind: 'integrativ',
      phase: null,
      issues: [],
    });
  });

  it('takes the phase from an override before the group', () => {
    const patched = loadDecisions(raw => {
      raw.components.phaseOverrides = { 'K6.2': 1 };
    });
    expect(deriveComponentFacts(patched, 'K6.2', 'teil2').phase).toBe(1);
    expect(deriveComponentFacts(patched, 'K6.1', 'teil1').phase).toBe(1);
  });

  it('marks an excluded component and names no kind for it', () => {
    expect(deriveComponentFacts(decisions, 'K18', 'wahl')).toMatchObject({
      number: 18,
      kind: null,
      excluded: true,
      issues: ['COMPONENT_EXCLUDED'],
    });
  });

  it('reports a component that nobody decided about', () => {
    expect(deriveComponentFacts(decisions, 'K26', 'teil2')).toMatchObject({
      kind: null,
      excluded: false,
      issues: ['NO_DECISION'],
    });
  });

  it('reports a kind that does not fit the group folder instead of guessing', () => {
    expect(deriveComponentFacts(decisions, 'K12', 'teil1').issues).toEqual([
      'KIND_GROUP_MISMATCH',
    ]);
    expect(deriveComponentFacts(decisions, 'K1', 'ganze').issues).toEqual([
      'KIND_GROUP_MISMATCH',
    ]);
    expect(deriveComponentFacts(decisions, 'K20', 'wahl').issues).toEqual([
      'KIND_GROUP_MISMATCH',
    ]);
  });

  it('knows the kind without a group but not the phase of a mandatory component', () => {
    expect(deriveComponentFacts(decisions, 'K1', null)).toMatchObject({
      kind: 'pflicht',
      phase: null,
      group: null,
      issues: ['NO_GROUP'],
    });
    expect(deriveComponentFacts(decisions, 'K12', null)).toMatchObject({
      kind: 'wahl',
      phase: null,
      issues: [],
    });
  });

  it('ignores the group of the global folder', () => {
    expect(deriveComponentFacts(decisions, 'K1', 'global')).toMatchObject({
      group: null,
      issues: ['NO_GROUP'],
    });
  });

  it('gives nothing for something that is not a component code', () => {
    expect(deriveComponentFacts(decisions, 'x', 'teil1')).toMatchObject({
      number: null,
      kind: null,
      issues: ['NO_DECISION'],
    });
    expect(deriveComponentFacts(decisions, '', null).number).toBeNull();
  });
});

describe('visibilityOf', () => {
  it('shows an enabler text and quiz questions to trainees, no solution part', () => {
    expect(visibilityOf('enabler', null)).toEqual({
      trainee: ['text'],
      trainerOnly: [],
      originalMayBePublic: true,
    });
    expect(visibilityOf('quiz', null)).toEqual({
      trainee: ['questions'],
      trainerOnly: ['correct_answer', 'rationale'],
      originalMayBePublic: false,
    });
    expect(visibilityOf('global_quiz', null).trainerOnly).toEqual([
      'correct_answer',
      'rationale',
    ]);
  });

  it('shows a whole scenario to trainees, solution approach and knowledge included', () => {
    expect(visibilityOf('scenario', null)).toEqual({
      trainee: [
        'situation',
        'task',
        'solution_scenario',
        'knowledge_contribution',
      ],
      trainerOnly: [],
      originalMayBePublic: true,
    });
  });

  it('keeps the model solution of a use case for trainers', () => {
    expect(visibilityOf('use_case', null)).toEqual({
      trainee: ['topics', 'situation', 'objective', 'steps'],
      trainerOnly: ['model_solution', 'criteria'],
      originalMayBePublic: false,
    });
  });

  it('judges the original by the type it is a copy of', () => {
    expect(visibilityOf('pdf_original', 'enabler').originalMayBePublic).toBe(
      true
    );
    expect(visibilityOf('pdf_original', 'scenario').originalMayBePublic).toBe(
      true
    );
    expect(visibilityOf('pdf_original', 'use_case').originalMayBePublic).toBe(
      false
    );
    expect(visibilityOf('pdf_original', 'quiz').originalMayBePublic).toBe(
      false
    );
    expect(
      visibilityOf('pdf_original', 'global_quiz').originalMayBePublic
    ).toBe(false);
    // an original of unknown type is never public
    expect(visibilityOf('pdf_original', null).originalMayBePublic).toBe(false);
  });
});
