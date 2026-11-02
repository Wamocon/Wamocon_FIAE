/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Routes that filter by the occupation OF THE REPORT (activity reports belong to one
// occupation since migration 20261102000300). The filter is made by three shared
// helpers of src/lib/auth/activity-report-access.ts. Their behaviour is tested with the
// routes of the reports (tests/integration/api/activity-reports/occupation.test.ts: two
// occupations, each tab its own list, trainer, aggregate). This file makes sure that
// every route that reads reports of a person uses one of these helpers, so a new or
// changed route cannot read the reports of both occupations by accident. The separation
// test of the regression suite (occupation-separation.test.ts) names this file for them.

const API = join(process.cwd(), 'src/app/api');
const HELPERS =
  /requireReportCatalogFilter|ensureReportInChosenCatalog|evaluationReportCatalogCondition/;

/** The GET routes that read the reports (or evaluations of reports) of a person. */
const REPORT_CATALOG_ROUTES = [
  'trainee/annual-summary',
  'trainee/school/reports',
  'trainer/annual-overview',
  'trainer/arbeitszeugnis/aggregate/[traineeId]',
  'trainer/arbeitszeugnis/evidence/[traineeId]',
  'trainer/evaluations',
  'trainer/activity-reports',
  'trainee/evaluations',
  'trainer/arbeitszeugnis/skill-radar/[traineeId]',
  'trainer/school/activity-reports',
  'trainer/school/stats',
  'trainer/trainees/with-stats',
];

describe('routes that read reports filter by the occupation of the report', () => {
  it.each(REPORT_CATALOG_ROUTES)(
    '%s uses a helper of the report filter',
    route => {
      const file = join(API, route, 'route.ts');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toMatch(HELPERS);
    }
  );

  it('the helpers are tested with two occupations', () => {
    const text = readFileSync(
      join(
        process.cwd(),
        'tests/integration/api/activity-reports/occupation.test.ts'
      ),
      'utf8'
    );
    expect(text).toContain('two occupations');
    expect(text).toContain('KfBM tab');
    expect(text).toContain('FIAE tab');
  });
});
