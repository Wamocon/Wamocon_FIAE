import { z } from 'zod';
import {
  isValidBrandingShortName,
  isValidBrandingTitle,
  normalizeBrandingAccent,
} from '@/lib/catalog/branding';

/**
 * Configuration of a training catalog (training_catalogs.settings, jsonb).
 *
 * Documented keys (snake_case, as stored in the database):
 *  - shortening_threshold     grade threshold for a shortened training
 *                             (FIAE 2.45, KfBM 2.49)
 *  - school_organization      'block' or 'weekdays'
 *  - shortened_training_rules object with rules for shortened training
 *  - softskill_criteria_set   key of the softskill criteria set
 *  - department_label         label of the department field
 *  - phase_months             months of phase 1 and phase 2, for example
 *                             [18, 18] (FIAE) or [15, 21] (KfBM)
 *  - branding                 presentation of the occupation (title, short_name,
 *                             accent), see src/lib/catalog/branding.ts, which
 *                             also reads it (not part of CatalogSettings)
 *
 * This module only defines the type, defaults and validation. Callers in the
 * Arbeitszeugnis code still use their own constants; switching them over is
 * follow-up work.
 */

export const SCHOOL_ORGANIZATIONS = ['block', 'weekdays'] as const;
export type SchoolOrganization = (typeof SCHOOL_ORGANIZATIONS)[number];

const positiveMonths = z.number().int().positive().max(120);

const brandingSchema = z
  .object({
    title: z.string().refine(isValidBrandingTitle, 'invalid title'),
    short_name: z
      .string()
      .refine(isValidBrandingShortName, 'invalid short name'),
    accent: z
      .string()
      .refine(v => normalizeBrandingAccent(v) !== null, 'invalid accent color'),
  })
  .partial()
  .strict();

/** Strict schema for writing settings (rejects unknown keys and bad values). */
export const catalogSettingsSchema = z
  .object({
    shortening_threshold: z.number().gt(1).lte(6),
    school_organization: z.enum(SCHOOL_ORGANIZATIONS),
    shortened_training_rules: z.record(z.unknown()),
    softskill_criteria_set: z.string().trim().min(1),
    department_label: z.string().trim().min(1),
    phase_months: z.tuple([positiveMonths, positiveMonths]),
    branding: brandingSchema,
  })
  .partial()
  .strict();

/** Settings as stored in the database (every key is optional). */
export type CatalogSettingsInput = z.infer<typeof catalogSettingsSchema>;

/** Settings with defaults applied, in camelCase for application code. */
export interface CatalogSettings {
  shorteningThreshold: number;
  schoolOrganization: SchoolOrganization;
  shortenedTrainingRules: Record<string, unknown> | null;
  softskillCriteriaSet: string | null;
  departmentLabel: string | null;
  phaseMonths: [number, number];
}

/**
 * Defaults that keep today's FIAE behaviour: shortening below a 2.45 average,
 * block school organisation and an 18 + 18 month phase split.
 */
const defaultCatalogSettings: CatalogSettings = {
  shorteningThreshold: 2.45,
  schoolOrganization: 'block',
  shortenedTrainingRules: null,
  softskillCriteriaSet: null,
  departmentLabel: null,
  phaseMonths: [18, 18],
};

export const DEFAULT_CATALOG_SETTINGS: Readonly<CatalogSettings> =
  Object.freeze(defaultCatalogSettings);

export type CatalogSettingsValidation =
  | { success: true; data: CatalogSettingsInput }
  | { success: false; errors: string[] };

/**
 * Validate settings before they are written (admin editing, import). Unknown
 * keys and invalid values are reported; nothing is silently dropped.
 */
export function validateCatalogSettings(
  input: unknown
): CatalogSettingsValidation {
  const parsed = catalogSettingsSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    errors: parsed.error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'settings';
      return `${path}: ${issue.message}`;
    }),
  };
}

/**
 * Tolerant read of stored settings: every key is checked on its own, invalid
 * or missing values fall back to the default of that key and unknown keys are
 * ignored. Never throws, so a bad row cannot break a page.
 */
export function resolveCatalogSettings(raw: unknown): CatalogSettings {
  const source =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const shape = catalogSettingsSchema.shape;

  const shorteningThreshold = shape.shortening_threshold.safeParse(
    source.shortening_threshold
  );
  const schoolOrganization = shape.school_organization.safeParse(
    source.school_organization
  );
  const shortenedTrainingRules = shape.shortened_training_rules.safeParse(
    source.shortened_training_rules
  );
  const softskillCriteriaSet = shape.softskill_criteria_set.safeParse(
    source.softskill_criteria_set
  );
  const departmentLabel = shape.department_label.safeParse(
    source.department_label
  );
  const phaseMonths = shape.phase_months.safeParse(source.phase_months);

  return {
    shorteningThreshold: shorteningThreshold.success
      ? (shorteningThreshold.data ??
        DEFAULT_CATALOG_SETTINGS.shorteningThreshold)
      : DEFAULT_CATALOG_SETTINGS.shorteningThreshold,
    schoolOrganization: schoolOrganization.success
      ? (schoolOrganization.data ?? DEFAULT_CATALOG_SETTINGS.schoolOrganization)
      : DEFAULT_CATALOG_SETTINGS.schoolOrganization,
    shortenedTrainingRules: shortenedTrainingRules.success
      ? (shortenedTrainingRules.data ??
        DEFAULT_CATALOG_SETTINGS.shortenedTrainingRules)
      : DEFAULT_CATALOG_SETTINGS.shortenedTrainingRules,
    softskillCriteriaSet: softskillCriteriaSet.success
      ? (softskillCriteriaSet.data ??
        DEFAULT_CATALOG_SETTINGS.softskillCriteriaSet)
      : DEFAULT_CATALOG_SETTINGS.softskillCriteriaSet,
    departmentLabel: departmentLabel.success
      ? (departmentLabel.data ?? DEFAULT_CATALOG_SETTINGS.departmentLabel)
      : DEFAULT_CATALOG_SETTINGS.departmentLabel,
    phaseMonths: phaseMonths.success
      ? (phaseMonths.data ?? [...DEFAULT_CATALOG_SETTINGS.phaseMonths])
      : [...DEFAULT_CATALOG_SETTINGS.phaseMonths],
  };
}
