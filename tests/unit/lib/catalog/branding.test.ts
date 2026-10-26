import {
  ACCENT_TOKENS,
  DEFAULT_CATALOG_BRANDING,
  FIAE_CATALOG_CODE,
  brandingCss,
  isBrandingApplied,
  isValidBrandingShortName,
  isValidBrandingTitle,
  normalizeBrandingAccent,
  resolveCatalogBranding,
} from '@/lib/catalog/branding';

describe('catalog branding', () => {
  describe('defaults', () => {
    it('keeps the FIAE look as the default', () => {
      expect(DEFAULT_CATALOG_BRANDING).toEqual({
        title: 'LFA Plattform',
        shortName: null,
        accent: null,
      });
      expect(Object.isFrozen(DEFAULT_CATALOG_BRANDING)).toBe(true);
    });

    it.each([undefined, null, 'x', 7, [], [{ title: 'A' }], {}])(
      'falls back to the defaults for %p',
      raw => {
        expect(resolveCatalogBranding(raw)).toEqual(DEFAULT_CATALOG_BRANDING);
      }
    );

    it('returns a fresh object, so a caller cannot change the default', () => {
      const first = resolveCatalogBranding(undefined);
      first.title = 'changed';
      expect(resolveCatalogBranding(undefined).title).toBe('LFA Plattform');
    });
  });

  describe('resolveCatalogBranding', () => {
    it('reads the stored keys (snake_case)', () => {
      expect(
        resolveCatalogBranding({
          title: 'KfBM Lernplattform',
          short_name: 'KfBM',
          accent: '#0F766E',
        })
      ).toEqual({
        title: 'KfBM Lernplattform',
        shortName: 'KfBM',
        accent: '#0f766e',
      });
    });

    it('reads its own output again (camelCase), so the client can re-check the API', () => {
      const wire = resolveCatalogBranding({
        title: 'Büro',
        short_name: 'KfBM',
        accent: 'teal',
      });
      expect(resolveCatalogBranding(wire)).toEqual(wire);
    });

    it('trims the texts and ignores unknown keys', () => {
      expect(
        resolveCatalogBranding({
          title: '  KfBM Plattform ',
          shortName: ' KfBM ',
          css: 'body{display:none}',
          logo: 'https://evil.example/x.png',
        })
      ).toEqual({
        title: 'KfBM Plattform',
        shortName: 'KfBM',
        accent: null,
      });
    });

    it('checks every key on its own: a bad value only resets that key', () => {
      expect(
        resolveCatalogBranding({
          title: '<script>alert(1)</script>',
          short_name: 'KfBM',
          accent: 'url(javascript:alert(1))',
        })
      ).toEqual({ title: 'LFA Plattform', shortName: 'KfBM', accent: null });
    });

    it('resolves a token to its hex value', () => {
      expect(resolveCatalogBranding({ accent: 'teal' }).accent).toBe(
        ACCENT_TOKENS.teal
      );
      expect(resolveCatalogBranding({ accent: ' Blue ' }).accent).toBe(
        ACCENT_TOKENS.blue
      );
    });
  });

  describe('normalizeBrandingAccent', () => {
    it.each([
      ['#0f766e', '#0f766e'],
      ['#0F766E', '#0f766e'],
      ['#abc', '#aabbcc'],
      ['#ABC', '#aabbcc'],
      ['teal', ACCENT_TOKENS.teal],
    ])('accepts %p', (input, expected) => {
      expect(normalizeBrandingAccent(input)).toBe(expected);
    });

    it.each([
      '',
      '0f766e',
      '#0f766',
      '#0f766e0',
      '#0f766g',
      '#0f766e;',
      'red',
      'rgb(1,2,3)',
      'hsl(1 2% 3%)',
      'var(--accent)',
      'url(x)',
      'expression(1)',
      '#fff; background:url(x)',
      '#0f766e\n',
      null,
      undefined,
      12,
      {},
      ['#fff'],
    ])('rejects %p', input => {
      expect(normalizeBrandingAccent(input)).toBeNull();
    });
  });

  describe('texts', () => {
    it.each(['KfBM Lernplattform', 'Büromanagement', 'A', 'LFA (Büro) 2025'])(
      'accepts the title %p',
      title => expect(isValidBrandingTitle(title)).toBe(true)
    );

    it.each([
      '',
      '   ',
      'x'.repeat(41),
      '<b>KfBM</b>',
      'a"b',
      "a'b;--",
      'line\nbreak',
      'tab\there',
      '{{x}}',
      'a`b',
      '\u202eevil',
      7,
      null,
    ])('rejects the title %p', title =>
      expect(isValidBrandingTitle(title)).toBe(false)
    );

    it('accepts and rejects the short name', () => {
      expect(isValidBrandingShortName('KfBM')).toBe(true);
      expect(isValidBrandingShortName('Büro')).toBe(true);
      expect(isValidBrandingShortName('x'.repeat(13))).toBe(false);
      expect(isValidBrandingShortName('<i>')).toBe(false);
      expect(isValidBrandingShortName('')).toBe(false);
    });
  });

  describe('isBrandingApplied', () => {
    it('never applies the branding for FIAE (pixel-identical look)', () => {
      expect(FIAE_CATALOG_CODE).toBe('FIAE');
      expect(isBrandingApplied('FIAE')).toBe(false);
      expect(isBrandingApplied('fiae')).toBe(false);
      expect(isBrandingApplied(' FIAE ')).toBe(false);
    });

    it('applies it for another occupation, not for no occupation', () => {
      expect(isBrandingApplied('KFBM')).toBe(true);
      expect(isBrandingApplied(null)).toBe(false);
      expect(isBrandingApplied(undefined)).toBe(false);
      expect(isBrandingApplied('')).toBe(false);
    });
  });

  describe('brandingCss', () => {
    it('is empty without an accent', () => {
      expect(brandingCss(null)).toBe('');
    });

    it('sets only accent, primary, ring and their text colors, for the dark and the light theme', () => {
      const css = brandingCss('#0f766e');
      expect(css).toMatch(/^:root,\.dark\{[^}]*\}\.light\{[^}]*\}$/);
      for (const variable of [
        '--accent',
        '--primary',
        '--ring',
        '--accent-foreground',
        '--primary-foreground',
      ]) {
        expect(css.split(`${variable}:`)).toHaveLength(3);
      }
      expect(css).not.toContain('--background');
      expect(css).not.toContain('--foreground:');
    });

    it('writes only numbers into the rules (hue, saturation, lightness)', () => {
      const css = brandingCss('#0f766e');
      const values = [...css.matchAll(/--[a-z-]+:([^;}]*)/g)].map(m => m[1]);
      expect(values).toHaveLength(10);
      for (const value of values) {
        expect(value).toMatch(/^\d{1,3} \d{1,3}% \d{1,3}%$/);
      }
    });

    it('keeps the text on the accent readable, in both themes, for every color', () => {
      const read = (css: string, selector: string, variable: string) => {
        const block = css.split(selector)[1].split('}')[0];
        const m = new RegExp(`${variable}:(\\d+) (\\d+)% (\\d+)%`).exec(block)!;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
      };
      // relative luminance of an HSL value (WCAG)
      const luminance = ([h, s, l]: number[]) => {
        const sat = s / 100;
        const light = l / 100;
        const chroma = (1 - Math.abs(2 * light - 1)) * sat;
        const lin = (n: number) => {
          const k = (n + h / 30) % 12;
          const v =
            light - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(0) + 0.7152 * lin(8) + 0.0722 * lin(4);
      };
      const contrast = (a: number[], b: number[]) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const accents = [
        '#ffffff',
        '#000000',
        '#f0f0ff',
        '#050510',
        '#00ffff',
        '#ffff00',
        '#ff00ff',
        ...Object.values(ACCENT_TOKENS),
      ];
      for (const accent of accents) {
        const css = brandingCss(accent);
        for (const [selector, min, max, needed] of [
          [':root,.dark{', 35, 66, 3],
          ['.light{', 25, 48, 4.5],
        ] as const) {
          const bg = read(css, selector, '--accent');
          const fg = read(css, selector, '--primary-foreground');
          expect(read(css, selector, '--primary')).toEqual(bg);
          expect(read(css, selector, '--ring')).toEqual(bg);
          expect(read(css, selector, '--accent-foreground')).toEqual(fg);
          // the accent stays inside the range of its theme
          expect(bg[2]).toBeGreaterThanOrEqual(min);
          expect(bg[2]).toBeLessThanOrEqual(max);
          // white or near black text, never less readable than needed
          expect([
            [0, 0, 100],
            [0, 0, 4],
          ]).toContainEqual(fg);
          expect(contrast(fg, bg)).toBeGreaterThanOrEqual(
            fg[2] === 100 ? needed : 4.5
          );
        }
      }
    });

    it('keeps white text where it is readable (a teal), near black where it is not (yellow)', () => {
      const teal = brandingCss('#0f766e');
      expect(teal).toContain(':root,.dark{--accent:175 77% 35%');
      expect(teal).toContain('--primary-foreground:0 0% 100%');
      const yellow = brandingCss('#ffff00');
      expect(yellow).toContain('--primary-foreground:0 0% 4%');
    });

    it('is deterministic and contains no free text', () => {
      expect(brandingCss('#1d4ed8')).toBe(
        brandingCss(normalizeBrandingAccent('#1D4ED8'))
      );
      expect(brandingCss('#1d4ed8')).not.toMatch(/url|expression|<|>|"|'/i);
    });

    it('refuses an accent that is not a normalized hex value', () => {
      expect(brandingCss('red' as any)).toBe('');
      expect(brandingCss('#fff' as any)).toBe('');
      expect(brandingCss('url(x)' as any)).toBe('');
    });
  });
});
