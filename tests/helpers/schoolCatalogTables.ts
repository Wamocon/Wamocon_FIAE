/**
 * Table fixtures for tests of the school routes (exams and blocks). Exams and
 * blocks belong to one occupation, so the routes read the catalog scope
 * (training_catalogs, organization_catalogs, trainee_enrollments) of the caller.
 */

export const FIAE = '00000000-0000-4000-8000-000000000001';
export const KFBM = '00000000-0000-4000-8000-000000000002';

export const CATALOG_ROWS = [
  {
    id: FIAE,
    code: 'FIAE',
    isActive: true,
    settings: { phase_months: [18, 18] },
  },
  {
    id: KFBM,
    code: 'KFBM',
    isActive: true,
    settings: { phase_months: [15, 21] },
  },
];

/** Both occupations are enabled for the organization. */
export const BOTH_ENABLED = [
  { trainingCatalogId: FIAE, isEnabled: true },
  { trainingCatalogId: KFBM, isEnabled: true },
];

/** The trainee in one occupation: FIAE (no enrollment counts as FIAE). */
export const SINGLE_FIAE_TABLES = {
  trainingCatalogs: CATALOG_ROWS,
  organizationCatalogs: [],
  traineeEnrollments: [],
};

/** Two enrollments: FIAE first (the default), KfBM second. */
export const TWO_ENROLLMENTS = [
  {
    trainingCatalogId: FIAE,
    startDate: '2026-08-01',
    createdAt: new Date(2026, 7, 1),
  },
  {
    trainingCatalogId: KFBM,
    startDate: '2027-02-01',
    createdAt: new Date(2027, 1, 1),
  },
];

/** The trainee in two occupations, both enabled for the organization. */
export const TWO_OCCUPATION_TABLES = {
  trainingCatalogs: CATALOG_ROWS,
  organizationCatalogs: BOTH_ENABLED,
  traineeEnrollments: TWO_ENROLLMENTS,
};
