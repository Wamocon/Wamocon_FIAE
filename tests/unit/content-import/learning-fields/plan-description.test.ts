import { OFFICIAL_LEARNING_FIELDS } from '@/lib/content-import/learning-fields/official';
import {
  buildLearningFieldPlan,
  validateLearningFieldPlan,
} from '@/lib/content-import/learning-fields/plan';
import type { TitleSet } from '@/lib/content-import/learning-fields/titles';

import { sampleIndex, sampleSheet } from './fixtures';

const NOW = new Date('2026-10-27T10:00:00Z');
const build = (titles: TitleSet | null = null, official?: boolean) =>
  buildLearningFieldPlan(sampleSheet(), sampleIndex(), {
    now: NOW,
    titles,
    official,
  });

describe('buildLearningFieldPlan: official descriptions', () => {
  it('carries the official description of every learning field', () => {
    const plan = build();
    expect(plan.learningFields.map(f => f.description)).toEqual(
      OFFICIAL_LEARNING_FIELDS.map(o => o.description)
    );
    expect(validateLearningFieldPlan(plan)).toEqual([]);
  });

  it('keeps the official description when the owner names another title', () => {
    const json: TitleSet = {
      titles: { 3: 'Eigener Titel' },
      years: {},
      source: 'json',
      warnings: [],
    };
    expect(build(json).learningFields[2].description).toBe(
      OFFICIAL_LEARNING_FIELDS[2].description
    );
  });

  it('has no description without the official data', () => {
    const plan = build(null, false);
    expect(plan.learningFields.every(f => f.description === null)).toBe(true);
    expect(validateLearningFieldPlan(plan)).toEqual([]);
  });

  it('still accepts a plan file without the description field', () => {
    const plan = build();
    for (const field of plan.learningFields) delete field.description;
    expect(validateLearningFieldPlan(plan)).toEqual([]);
  });

  it('refuses a description that is not the official text', () => {
    const plan = build();
    plan.learningFields[0].description = 'Ein eigener Text.';
    expect(validateLearningFieldPlan(plan)).toContain(
      'LF1: the description must be the official description or empty.'
    );
  });
});
