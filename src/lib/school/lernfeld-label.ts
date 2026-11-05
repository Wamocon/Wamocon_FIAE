/**
 * The abbreviation of a Lernfeld as shown to people. The two occupations store
 * it differently (FIAE "LF-1", KfBM "LF1", the import of KfBM writes LF1 to
 * LF13 on purpose, the code is a key and stays as it is). Shown, both read
 * "LF-1". Anything that is not such a code (for example "SONSTIGES") comes
 * back unchanged.
 */
export function formatLernfeldLabel(code: string | null | undefined): string {
  if (!code) return '';
  const match = /^\s*LF[\s._-]*(\d{1,3}[a-z]?)\s*$/i.exec(code);
  return match ? `LF-${match[1]}` : code;
}

/**
 * Order of the Lernfelder by their code, the number counts and not the text:
 * LF-1, LF-2, ... LF-10, LF-11, LF-12 (as text LF-10 would come before LF-2).
 * "LF-12a" follows "LF-12". A code without a number ("SONSTIGES") goes behind
 * the numbered ones. Works for "LF-1" and "LF1" alike.
 */
export function compareLernfeldLabels(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const parse = (code: string | null | undefined) => {
    const match = /^\s*LF[\s._-]*(\d{1,3})([a-z]?)\s*$/i.exec(code ?? '');
    return match
      ? { number: Number(match[1]), suffix: match[2].toLowerCase() }
      : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (left && right) {
    return left.number !== right.number
      ? left.number - right.number
      : left.suffix.localeCompare(right.suffix);
  }
  if (left) return -1;
  if (right) return 1;
  return String(a ?? '').localeCompare(String(b ?? ''), 'de');
}
