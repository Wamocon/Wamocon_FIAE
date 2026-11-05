/**
 * "1 Azubi" and "2 Azubis": the translation system has no plural forms, so a
 * text with a number has two keys. `key` is the plural text with `{count}`,
 * `key.one` the text for exactly one. A missing `key.one` falls back to `key`.
 */
export function countLabel(
  t: (key: string) => string,
  key: string,
  count: number
): string {
  const oneKey = `${key}.one`;
  const one = count === 1 ? t(oneKey) : oneKey;
  const text = count === 1 && one !== oneKey ? one : t(key);
  return text.replace('{count}', String(count));
}
