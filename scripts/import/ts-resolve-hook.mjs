// Module resolution hook for the import scripts. The TypeScript modules under
// src/lib/content-import import each other without a file extension (as the
// bundler and Jest expect). Node's type stripping needs the extension, so this
// hook retries a relative import without extension with ".ts".
//
// Registered by kfbm-apply-modules.mjs. Only relative specifiers are touched.

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = /^\.\.?\//.test(specifier);
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && relative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
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
