/**
 * Branding of a training catalog (occupation): how the platform presents
 * itself when the active occupation is not FIAE. Pure functions without server
 * or React imports, so the API route and the client share the same checks.
 *
 * Source: the settings key `branding` of training_catalogs.settings, for
 * example
 *
 *   { "title": "KfBM Lernplattform", "short_name": "KfBM", "accent": "teal" }
 *
 *  - title       name of the platform in the browser title
 *  - short_name  short label of the occupation (badge in the header)
 *  - accent      accent color, a hex value (#rgb, #rrggbb) or one of the fixed
 *                tokens in ACCENT_TOKENS
 *
 * The values are checked strictly and every key on its own: a missing or
 * invalid value falls back to today's FIAE look, nothing is passed on as free
 * text or free CSS. The only thing that ever reaches a style rule is a color
 * that was reduced to three numbers (hue, saturation, lightness).
 */

export const FIAE_CATALOG_CODE = 'FIAE';

/** Name of the platform today (browser title of the layout). */
export const DEFAULT_PLATFORM_TITLE = 'LFA Plattform';

/** Resolved branding, with defaults applied. */
export interface CatalogBranding {
  /** Name of the platform in the browser title. */
  title: string;
  /** Short label of the occupation, null if there is none. */
  shortName: string | null;
  /** Accent as lower case #rrggbb, null keeps the default colors. */
  accent: string | null;
}

/** Today's FIAE look: platform title, no badge, the default (red) colors. */
export const DEFAULT_CATALOG_BRANDING: Readonly<CatalogBranding> =
  Object.freeze({
    title: DEFAULT_PLATFORM_TITLE,
    shortName: null,
    accent: null,
  });

/** Fixed accent tokens an administrator can use instead of a hex value. */
export const ACCENT_TOKENS = {
  teal: '#0f766e',
  blue: '#1d4ed8',
  green: '#15803d',
  violet: '#6d28d9',
  amber: '#b45309',
  rose: '#be123c',
} as const;

// Letters (with German umlauts), digits and a few separators. No quotes,
// angle brackets, semicolons, backticks, braces, control or bidi characters.
const TITLE = /^[A-Za-z0-9ÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß .,&+\-_/()]{0,39}$/;
const SHORT_NAME = /^[A-Za-z0-9ÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß .&+\-_/]{0,11}$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;
const NORMALIZED_HEX = /^#[0-9a-f]{6}$/;

/** Title for the browser title: 1 to 40 characters from a small alphabet. */
export function isValidBrandingTitle(value: unknown): value is string {
  return typeof value === 'string' && TITLE.test(value);
}

/** Short label: 1 to 12 characters from a small alphabet. */
export function isValidBrandingShortName(value: unknown): value is string {
  return typeof value === 'string' && SHORT_NAME.test(value);
}

/**
 * Accent as lower case #rrggbb from a hex value (#rgb or #rrggbb) or a token
 * of ACCENT_TOKENS, otherwise null. Nothing else is accepted: no color names,
 * no rgb() or hsl() functions, no var(), no url(), no surrounding white space.
 */
export function normalizeBrandingAccent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ACCENT_TOKENS, text)) {
    return ACCENT_TOKENS[text as keyof typeof ACCENT_TOKENS];
  }
  if (!HEX_COLOR.test(text)) return null;
  if (text.length === 4) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  return text;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/**
 * Tolerant read of a stored `branding` object (or of the object the API sends,
 * which uses the key shortName). Never throws: each key is checked on its own,
 * an invalid or missing value falls back to the default of that key and
 * unknown keys are ignored.
 */
export function resolveCatalogBranding(raw: unknown): CatalogBranding {
  const source =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const title = textValue(source.title);
  const shortName = textValue(source.short_name ?? source.shortName);

  return {
    title:
      title !== null && isValidBrandingTitle(title)
        ? title
        : DEFAULT_CATALOG_BRANDING.title,
    shortName:
      shortName !== null && isValidBrandingShortName(shortName)
        ? shortName
        : DEFAULT_CATALOG_BRANDING.shortName,
    accent: normalizeBrandingAccent(
      typeof source.accent === 'string' ? source.accent.trim() : source.accent
    ),
  };
}

/**
 * Whether the branding of an occupation is shown. FIAE keeps today's look
 * untouched, whatever its settings say.
 */
export function isBrandingApplied(code: string | null | undefined): boolean {
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return normalized !== '' && normalized !== FIAE_CATALOG_CODE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness * 100];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, saturation * 100, lightness * 100];
}

/** HSL (degrees, percent, percent) to relative luminance (WCAG). */
function luminance(h: number, s: number, l: number): number {
  const sat = s / 100;
  const light = l / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value =
      light - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

/** Text colors on the accent (triplets like the theme variables). */
const WHITE = '0 0% 100%';
const NEAR_BLACK = '0 0% 4%';
const NEAR_BLACK_LUMINANCE = luminance(0, 0, 4);

/**
 * The accent as hue, saturation and lightness for one theme, with the text
 * color on it. The lightness is moved into the range. The text stays white (as
 * today) as long as it has the contrast; a bright accent such as yellow gets
 * near black text instead, so the text is readable for every color.
 */
function fitTheme(
  hex: string,
  minLightness: number,
  maxLightness: number,
  minWhiteContrast: number
): { accent: string; foreground: string } {
  const [h, s, l] = hexToHsl(hex);
  const hue = Math.round(h);
  const saturation = Math.round(s);
  const lightness = Math.round(clamp(l, minLightness, maxLightness));
  const lum = luminance(hue, saturation, lightness);
  const white = 1.05 / (lum + 0.05);
  const dark = (lum + 0.05) / (NEAR_BLACK_LUMINANCE + 0.05);
  return {
    accent: `${hue} ${saturation}% ${lightness}%`,
    foreground: white >= minWhiteContrast || white >= dark ? WHITE : NEAR_BLACK,
  };
}

/**
 * Style rules for an accent color, in the format of the theme variables
 * (src/app/globals.css): accent, primary and ring, and the text color on them.
 * The accent is moved into a readable range per theme (lightness 35 to 66
 * percent in the dark theme, 25 to 48 percent in the light one). White text
 * stays if it has a contrast of at least 3 (dark theme, like today's red) or
 * 4.5 (light theme), otherwise near black text is used. Returns an empty string
 * without a valid, normalized #rrggbb accent, so nothing but numbers can end up
 * in the rules.
 */
export function brandingCss(accent: string | null): string {
  if (typeof accent !== 'string' || !NORMALIZED_HEX.test(accent)) return '';
  const dark = fitTheme(accent, 35, 66, 3);
  const light = fitTheme(accent, 25, 48, 4.5);
  const rule = (theme: { accent: string; foreground: string }) =>
    `--accent:${theme.accent};--primary:${theme.accent};--ring:${theme.accent};` +
    `--accent-foreground:${theme.foreground};--primary-foreground:${theme.foreground}`;
  return `:root,.dark{${rule(dark)}}.light{${rule(light)}}`;
}
