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
