// Class names shared by the pages of the content upload. Colours that carry text are
// chosen for a contrast of at least 4.5 to 1 in the dark and the light theme: white
// on red-700 (6.5 to 1), the text colour of the page on the page, never the accent
// colour of the theme as a ground for small text.

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500';

export const BTN_PRIMARY = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-2.5 font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export const BTN_SECONDARY = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 font-medium text-foreground transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** A smaller button for a table cell (still more than 24 by 24 pixels). */
export const BTN_SMALL = `inline-flex min-h-[32px] items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1 text-sm font-medium text-foreground transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export const FIELD = `min-h-[44px] w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground ${FOCUS}`;

export const SELECT_SMALL = `min-h-[36px] rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground ${FOCUS}`;

export const LABEL = 'text-foreground mb-1.5 block text-sm font-medium';

export const CARD =
  'glass-effect glass-static rounded-3xl border p-6 shadow-lg';

export const NOTICE_INFO =
  'rounded-2xl border border-blue-500 bg-blue-500/10 p-4 text-sm text-foreground';
export const NOTICE_WARN =
  'rounded-2xl border border-amber-500 bg-amber-500/10 p-4 text-sm text-foreground';
export const NOTICE_ERROR =
  'rounded-2xl border border-red-500 bg-red-500/10 p-4 text-sm text-foreground';
