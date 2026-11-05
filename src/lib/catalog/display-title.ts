/**
 * Display name of an occupation (training catalog) in the language of the user.
 *
 * `training_catalogs.title` is database content in German. The English names
 * live in the translation system under `catalog.names.<CODE>` (en.json only):
 * a code without such a key, and the German view, keep the title of the
 * database. No database change is needed for a new occupation, it shows its
 * title until a name is added to the translations.
 */
export function catalogDisplayTitle(
  t: (key: string) => string,
  code: string | null | undefined,
  title: string | null | undefined
): string {
  const fallback = (title ?? '').trim() || (code ?? '');
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!normalized) return fallback;
  const key = `catalog.names.${normalized}`;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
}
