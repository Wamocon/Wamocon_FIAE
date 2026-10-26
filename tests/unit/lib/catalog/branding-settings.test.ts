import {
  DEFAULT_CATALOG_SETTINGS,
  resolveCatalogSettings,
  validateCatalogSettings,
} from '@/lib/catalog/settings';

// The settings key `branding` (see src/lib/catalog/branding.ts) is part of the
// strict write schema, so an administrator can store it. Reading the other
// settings does not change.
describe('catalog settings: branding key', () => {
  it('accepts a valid branding object', () => {
    const result = validateCatalogSettings({
      phase_months: [15, 21],
      branding: {
        title: 'KfBM Lernplattform',
        short_name: 'KfBM',
        accent: 'teal',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a partial branding object and an empty one', () => {
    expect(
      validateCatalogSettings({ branding: { accent: '#0f766e' } }).success
    ).toBe(true);
    expect(validateCatalogSettings({ branding: {} }).success).toBe(true);
  });

  it.each([
    ['unknown branding key', { branding: { logo: 'x.png' } }],
    ['free css as accent', { branding: { accent: 'red; background:url(x)' } }],
    ['color name as accent', { branding: { accent: 'red' } }],
    ['function as accent', { branding: { accent: 'rgb(1,2,3)' } }],
    ['markup in the title', { branding: { title: '<b>x</b>' } }],
    ['too long title', { branding: { title: 'x'.repeat(41) } }],
    ['too long short name', { branding: { short_name: 'x'.repeat(13) } }],
    ['branding as string', { branding: 'teal' }],
    ['branding as array', { branding: [] }],
  ])('rejects %s', (_label, input) => {
    const result = validateCatalogSettings(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toContain('branding');
    }
  });

  it('leaves the resolved settings as they were (no branding member)', () => {
    const resolved = resolveCatalogSettings({
      phase_months: [15, 21],
      branding: { title: 'KfBM', accent: 'teal' },
    });
    expect(resolved).toEqual({
      ...DEFAULT_CATALOG_SETTINGS,
      phaseMonths: [15, 21],
    });
    expect(resolved).not.toHaveProperty('branding');
  });
});
