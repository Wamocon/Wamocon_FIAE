import {
  DEFAULT_CATALOG_SETTINGS,
  resolveCatalogSettings,
  validateCatalogSettings,
} from '@/lib/catalog/settings';

describe('catalog settings', () => {
  describe('validateCatalogSettings', () => {
    it('accepts an empty object', () => {
      expect(validateCatalogSettings({})).toEqual({ success: true, data: {} });
    });

    it('accepts the FIAE and KfBM seed values', () => {
      const fiae = {
        shortening_threshold: 2.45,
        school_organization: 'block',
        phase_months: [18, 18],
      };
      const kfbm = {
        shortening_threshold: 2.49,
        school_organization: 'weekdays',
        phase_months: [15, 21],
      };
      expect(validateCatalogSettings(fiae).success).toBe(true);
      expect(validateCatalogSettings(kfbm).success).toBe(true);
    });

    it('accepts all documented keys', () => {
      const result = validateCatalogSettings({
        shortening_threshold: 2.49,
        school_organization: 'weekdays',
        shortened_training_rules: { minGrade: 2.49 },
        softskill_criteria_set: 'mes',
        department_label: 'Abteilung',
        phase_months: [15, 21],
      });
      expect(result.success).toBe(true);
    });

    it.each([
      ['unknown key', { shortening_treshold: 2.45 }],
      ['school organisation value', { school_organization: 'monthly' }],
      ['threshold as string', { shortening_threshold: '2.45' }],
      ['threshold out of range', { shortening_threshold: 7 }],
      ['phase months with one entry', { phase_months: [18] }],
      ['phase months with zero', { phase_months: [0, 36] }],
      ['phase months with a fraction', { phase_months: [17.5, 18.5] }],
      ['empty department label', { department_label: ' ' }],
      ['not an object', 'block'],
      ['array', []],
    ])('rejects %s', (_label, input) => {
      const result = validateCatalogSettings(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('names the offending key in the error', () => {
      const result = validateCatalogSettings({ school_organization: 'x' });
      expect(result).toEqual({
        success: false,
        errors: [expect.stringContaining('school_organization')],
      });
    });
  });

  describe('resolveCatalogSettings', () => {
    it('returns the FIAE compatible defaults for empty input', () => {
      expect(resolveCatalogSettings({})).toEqual(DEFAULT_CATALOG_SETTINGS);
      expect(DEFAULT_CATALOG_SETTINGS.shorteningThreshold).toBe(2.45);
      expect(DEFAULT_CATALOG_SETTINGS.phaseMonths).toEqual([18, 18]);
    });

    it.each([null, undefined, 'x', 3, []])(
      'falls back to the defaults for %p',
      raw => {
        expect(resolveCatalogSettings(raw)).toEqual(DEFAULT_CATALOG_SETTINGS);
      }
    );

    it('maps stored snake_case keys to camelCase', () => {
      const resolved = resolveCatalogSettings({
        shortening_threshold: 2.49,
        school_organization: 'weekdays',
        shortened_training_rules: { a: 1 },
        softskill_criteria_set: 'mes',
        department_label: 'Abteilung',
        phase_months: [15, 21],
      });
      expect(resolved).toEqual({
        shorteningThreshold: 2.49,
        schoolOrganization: 'weekdays',
        shortenedTrainingRules: { a: 1 },
        softskillCriteriaSet: 'mes',
        departmentLabel: 'Abteilung',
        phaseMonths: [15, 21],
      });
    });

    it('falls back per key and ignores unknown keys', () => {
      const resolved = resolveCatalogSettings({
        shortening_threshold: 'bad',
        school_organization: 'weekdays',
        phase_months: [15],
        something_new: true,
      });
      expect(resolved.shorteningThreshold).toBe(2.45);
      expect(resolved.schoolOrganization).toBe('weekdays');
      expect(resolved.phaseMonths).toEqual([18, 18]);
      expect(resolved).not.toHaveProperty('something_new');
    });

    it('does not share the default phase months array', () => {
      const resolved = resolveCatalogSettings({});
      resolved.phaseMonths[0] = 99;
      expect(DEFAULT_CATALOG_SETTINGS.phaseMonths).toEqual([18, 18]);
    });
  });
});
