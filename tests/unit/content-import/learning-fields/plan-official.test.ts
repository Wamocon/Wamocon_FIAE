import {
  OFFICIAL_LEARNING_FIELDS,
  officialHours,
} from '@/lib/content-import/learning-fields/official';
import {
  buildLearningFieldPlan,
  renderLearningFieldSummary,
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

describe('buildLearningFieldPlan: official titles and hours', () => {
  it('lists the 13 learning fields with the official title, year and hours', () => {
    const plan = build();
    expect(plan.learningFields).toHaveLength(13);
    expect(
      plan.learningFields.map(f => [
        f.code,
        f.title,
        f.trainingYear,
        f.hoursBudget,
        f.orderIndex,
      ])
    ).toEqual(
      OFFICIAL_LEARNING_FIELDS.map(o => [
        `LF${o.number}`,
        o.title,
        o.trainingYear,
        o.hours,
        o.number,
      ])
    );
    expect(
      plan.learningFields.every(
        f => f.titleSource === 'official' && !f.titleProvisional
      )
    ).toBe(true);
  });

  it('adds up to 880 hours, 320 in year 1, 280 in year 2, 280 in year 3', () => {
    const plan = build();
    const sum = (year?: number) =>
      plan.learningFields
        .filter(f => year === undefined || f.trainingYear === year)
        .reduce((n, f) => n + (f.hoursBudget ?? 0), 0);
    expect([sum(), sum(1), sum(2), sum(3)]).toEqual([880, 320, 280, 280]);
    expect(sum()).toBe(officialHours());
    expect(plan.learningFields[10]).toMatchObject({
      code: 'LF11',
      hoursBudget: 40,
    });
  });

  it('counts the fields in the statistics and drops the two open points', () => {
    const plan = build();
    expect(plan.stats.learningFields).toEqual({
      total: 13,
      withProvisionalTitle: 0,
      withPlaceholderTitle: 0,
      withHours: 13,
    });
    expect(plan.open).not.toContain('HOURS_BUDGET');
    expect(plan.open).not.toContain('TITLES_PROVISIONAL');
    expect(validateLearningFieldPlan(plan)).toEqual([]);
  });

  it('prefers the official title to a title of the source list', () => {
    const csv: TitleSet = {
      titles: { 1: 'Die eigene Rolle', 2: 'Büroprozesse' },
      years: { 1: 1 },
      source: 'csv',
      warnings: [],
    };
    const plan = build(csv);
    expect(plan.learningFields[0]).toMatchObject({
      title: OFFICIAL_LEARNING_FIELDS[0].title,
      titleSource: 'official',
    });
    expect(plan.learningFields[1].title).toBe(
      OFFICIAL_LEARNING_FIELDS[1].title
    );
  });

  it('prefers a title file of the owner to the official title, hours stay official', () => {
    const json: TitleSet = {
      titles: { 3: 'Eigener Titel' },
      years: {},
      source: 'json',
      warnings: [],
    };
    const plan = build(json);
    expect(plan.learningFields[2]).toMatchObject({
      title: 'Eigener Titel',
      titleSource: 'json',
      titleProvisional: false,
      hoursBudget: 80,
    });
    expect(plan.learningFields[0].titleSource).toBe('official');
  });

  it('without the official data the old behaviour stays: placeholder titles and no hours', () => {
    const plan = build(null, false);
    expect(plan.learningFields[0]).toMatchObject({
      title: 'Lernfeld 1',
      titleSource: 'placeholder',
      titleProvisional: true,
      hoursBudget: null,
    });
    expect(plan.open).toEqual(
      expect.arrayContaining(['HOURS_BUDGET', 'TITLES_PROVISIONAL'])
    );
    expect(plan.stats.learningFields.withHours).toBe(0);
  });

  it('shows the hours and their sum in the summary', () => {
    const text = renderLearningFieldSummary(build());
    expect(text).toContain('| LF4 | 1 | Rahmenlehrplan (amtlich) | 120 |');
    expect(text).toContain('| LF11 | 3 | Rahmenlehrplan (amtlich) | 40 |');
    expect(text).toContain('Summe der Zeitrichtwerte: 880 Stunden');
    expect(text).not.toContain('Stunden je Lernfeld: Keine Quelle');
  });
});

describe('validateLearningFieldPlan: official entries', () => {
  it('refuses a title that is called official but is not', () => {
    const plan = build();
    plan.learningFields[0].title = 'Etwas anderes';
    expect(validateLearningFieldPlan(plan)).toContain(
      'LF1: the title is marked official but is not the official title.'
    );
  });

  it('refuses hours that are not the official time guideline of an official field', () => {
    const plan = build();
    plan.learningFields[10].hoursBudget = 400;
    expect(validateLearningFieldPlan(plan)).toContain(
      'LF11: the hours of an official learning field must be the official time guideline.'
    );
  });

  it('refuses a source that is not known', () => {
    const plan = build();
    (plan.learningFields[0] as { titleSource: string }).titleSource = 'pdf';
    expect(validateLearningFieldPlan(plan)).toContain(
      'LF1: the title source is not known.'
    );
  });

  it('still takes a plan with an empty or a whole number of hours only', () => {
    const plan = build();
    plan.learningFields[0].hoursBudget = 40.5;
    expect(validateLearningFieldPlan(plan)).toContain(
      'LF1: the hours must be empty or a whole number of 0 or more.'
    );
  });
});
