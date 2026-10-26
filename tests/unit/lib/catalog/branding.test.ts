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
          // the accent starts in this range and moves further, only where the
          // contrast as text asks for it (see the next describe)
          [':root,.dark{', 35, 100, 3],
          ['.light{', 0, 48, 4.5],
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

  describe('the accent as text (contrast against the page, WCAG)', () => {
    // Page colors of src/app/globals.css
    const DARK_PAGE = '#0a0a0a';
    const LIGHT_PAGE = '#fafafa';
    const DARK_CARD = '#0f0f0f';
    const LIGHT_CARD = '#ffffff';
    const MIN = 4.5;

    type Rgb = [number, number, number];
    const fromHex = (hex: string): Rgb => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    // HSL to the 8 bit color a browser paints
    const fromHsl = (h: number, s: number, l: number): Rgb => {
      const sat = s / 100;
      const light = l / 100;
      const a = sat * Math.min(light, 1 - light);
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      };
      return [f(0), f(8), f(4)].map(v => Math.round(v * 255)) as Rgb;
    };
    const lum = (rgb: Rgb) => {
      const [r, g, b] = rgb.map(v => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: Rgb, b: Rgb) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // the rule of CatalogBadge: the accent at 15 percent over the card
    const badgeSurface = (accent: Rgb, card: Rgb): Rgb =>
      accent.map((v, i) => Math.round(0.15 * v + 0.85 * card[i])) as Rgb;

    const accentOf = (css: string, theme: 'dark' | 'light') => {
      const block = css.split(theme === 'dark' ? ':root,.dark{' : '.light{')[1];
      const m = /--accent:(\d+) (\d+)% (\d+)%/.exec(block.split('}')[0])!;
      return { h: +m[1], s: +m[2], l: +m[3] };
    };
    const asText = (accent: string, theme: 'dark' | 'light') => {
      const { h, s, l } = accentOf(brandingCss(accent), theme);
      return fromHsl(h, s, l);
    };

    // Measured in the review (text on #0a0a0a): blue 2.97, violet 2.73, rose 3.18
    it.each(Object.entries(ACCENT_TOKENS))(
      'the token %s is readable as text in both themes (%s)',
      (_name, hex) => {
        expect(
          contrast(asText(hex, 'dark'), fromHex(DARK_PAGE))
        ).toBeGreaterThanOrEqual(MIN);
        expect(
          contrast(asText(hex, 'light'), fromHex(LIGHT_PAGE))
        ).toBeGreaterThanOrEqual(MIN);
      }
    );

    it.each([
      '#ffeb3b', // yellow, 1.33 on the light page before
      '#ffff00',
      '#00ffff',
      '#ff00ff',
      '#ffffff',
      '#000000',
      '#050510',
      '#808080',
      '#3366cc',
      '#9b59b6',
      '#e91e63',
      '#4caf50',
      '#ff9800',
    ])('a free color (%s) is readable as text in both themes', hex => {
      expect(
        contrast(asText(hex, 'dark'), fromHex(DARK_PAGE))
      ).toBeGreaterThanOrEqual(MIN);
      expect(
        contrast(asText(hex, 'light'), fromHex(LIGHT_PAGE))
      ).toBeGreaterThanOrEqual(MIN);
    });

    it('holds for a sweep over hue, saturation and lightness', () => {
      const hex2 = (n: number) => n.toString(16).padStart(2, '0');
      let checked = 0;
      for (let h = 0; h < 360; h += 15) {
        for (const s of [20, 60, 100]) {
          for (const l of [8, 25, 40, 50, 60, 75, 92]) {
            const [r, g, b] = fromHsl(h, s, l);
            const hex = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
            expect(
              contrast(asText(hex, 'dark'), fromHex(DARK_PAGE))
            ).toBeGreaterThanOrEqual(MIN);
            expect(
              contrast(asText(hex, 'light'), fromHex(LIGHT_PAGE))
            ).toBeGreaterThanOrEqual(MIN);
            checked += 1;
          }
        }
      }
      expect(checked).toBe(24 * 3 * 7);
    });

    it('also holds on the tinted surface of the badge (small text, 15 percent accent over the card)', () => {
      for (const hex of [
        ...Object.values(ACCENT_TOKENS),
        '#ffeb3b',
        '#3366cc',
        '#00ffff',
      ]) {
        const dark = asText(hex, 'dark');
        const light = asText(hex, 'light');
        expect(
          contrast(dark, badgeSurface(dark, fromHex(DARK_CARD)))
        ).toBeGreaterThanOrEqual(MIN);
        expect(
          contrast(light, badgeSurface(light, fromHex(LIGHT_CARD)))
        ).toBeGreaterThanOrEqual(MIN);
      }
    });

    it('leaves the KfBM teal as it was in the dark theme and keeps its hue and saturation in the light one', () => {
      const css = brandingCss('#0f766e');
      expect(css).toContain(':root,.dark{--accent:175 77% 35%');
      const light = accentOf(css, 'light');
      expect(light.h).toBe(175);
      expect(light.s).toBe(77);
      // a little darker at most, never lighter
      expect(light.l).toBeLessThanOrEqual(26);
      expect(light.l).toBeGreaterThanOrEqual(20);
    });

    it('keeps hue and saturation of the color, only the lightness moves', () => {
      const [h, s] = [224, 76]; // #1d4ed8
      for (const theme of ['dark', 'light'] as const) {
        const a = accentOf(brandingCss('#1d4ed8'), theme);
        expect([a.h, a.s]).toEqual([h, s]);
      }
    });

    it('makes a color lighter in the dark theme and darker in the light theme, never the other way', () => {
      // #3366cc: lightness 50 percent
      expect(accentOf(brandingCss('#3366cc'), 'dark').l).toBeGreaterThan(50);
      expect(accentOf(brandingCss('#3366cc'), 'light').l).toBeLessThanOrEqual(
        48
      );
      // yellow: far too light for the light theme
      expect(accentOf(brandingCss('#ffeb3b'), 'light').l).toBeLessThan(35);
    });

    it('keeps the text on the accent surface readable after the move (white or near black, as before)', () => {
      for (const hex of [
        ...Object.values(ACCENT_TOKENS),
        '#ffeb3b',
        '#3366cc',
      ]) {
        const css = brandingCss(hex);
        for (const theme of ['dark', 'light'] as const) {
          const { h, s, l } = accentOf(css, theme);
          const block = css
            .split(theme === 'dark' ? ':root,.dark{' : '.light{')[1]
            .split('}')[0];
          const fg = /--primary-foreground:(\d+) (\d+)% (\d+)%/.exec(block)!;
          const text = fromHsl(+fg[1], +fg[2], +fg[3]);
          expect(contrast(text, fromHsl(h, s, l))).toBeGreaterThanOrEqual(
            theme === 'dark' && text[0] === 255 ? 3 : MIN
          );
        }
      }
    });
  });
});
