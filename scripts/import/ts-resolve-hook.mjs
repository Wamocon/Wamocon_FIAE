// Module resolution hook for the import scripts. The TypeScript modules under
// src/lib/content-import import each other without a file extension (as the
// bundler and Jest expect). Node's type stripping needs the extension, so this
// hook retries a relative import without extension with ".ts".
//
// Registered by kfbm-apply-modules.mjs and kfbm-source.mjs. Only relative
// specifiers and the "@/" alias are touched.

const SRC_ROOT = new URL('../../src/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  // The "@/" alias of the app (tsconfig paths) points to src/. A few modules
  // that the content upload tools load (the PDF text cleaner) use it.
  const aliased = specifier.startsWith('@/');
  const target = aliased
    ? new URL(specifier.slice(2), SRC_ROOT).href
    : specifier;
  // The alias never leaves src/ (no "..", no protocol relative form)
  if (aliased && !target.startsWith(SRC_ROOT.href)) {
    throw new Error(`The alias path leaves src/: ${specifier}`);
  }
  try {
    return await nextResolve(target, context);
  } catch (error) {
    const relative = /^\.\.?\//.test(specifier) || aliased;
    const hasExtension = /\.[a-z0-9]+$/i.test(target);
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && relative && !hasExtension) {
      return nextResolve(`${target}.ts`, context);
    }
    throw error;
  }
}

// The package has no "type" field, so Node would warn for every TypeScript
// file that it reparses it as an ES module. Naming the format avoids that.
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    return nextLoad(url, { ...context, format: 'module-typescript' });
  }
  return nextLoad(url, context);
}
