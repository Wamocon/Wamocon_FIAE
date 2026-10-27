// Shared helpers of the KfBM import scripts: the walk over the source folder
// (names, sizes, attributes, never contents), the OneDrive placeholder check and
// the loading of the TypeScript parsers.
//
// Read only. No network, no database, no model call. The source folder is never
// changed.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';

// The use case parser imports a sibling module without a file extension (as the
// bundler and Jest expect), the hook adds the extension and names the format.
register('./ts-resolve-hook.mjs', import.meta.url);

// The parsers are TypeScript files under src/lib/content-import. Node strips
// the types while loading them. The package has no "type" field, so Node warns
// once per file that it reparses the file as an ES module. That warning is
// harmless here and is filtered while the modules load.
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const code = typeof args[0] === 'object' && args[0] ? args[0].code : args[1];
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  return originalEmitWarning.call(process, warning, ...args);
};
const lib = name =>
  import(
    new URL(`../../src/lib/content-import/${name}.ts`, import.meta.url).href
  );
const [pathModule, parserModule, docxModule, useCaseModule] = await Promise.all(
  [
    lib('path-info'),
    lib('source-parsers'),
    lib('docx-paragraphs'),
    lib('use-cases/parser'),
  ]
);
process.emitWarning = originalEmitWarning;

export const { pathInfo, globalQuizComponentKey, enablerKeysMatch } =
  pathModule;
export const { parseQuizText, parseScenarioText } = parserModule;
export const { extractDocxParagraphs, extractDocxStats } = docxModule;
export const { parseUseCaseText } = useCaseModule;

/** File attributes of a OneDrive placeholder (not downloaded to this device). */
const FILE_ATTRIBUTE_OFFLINE = 0x1000;
const FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000;

/**
 * True when reading the file would download it first (placeholder). Reading
 * such a file can fail or block, so the scripts skip it and count it.
 * @param {number | null | undefined} attributes Windows file attributes
 */
export function isPlaceholderAttr(attributes) {
  if (typeof attributes !== 'number') return false;
  return (
    (attributes &
      (FILE_ATTRIBUTE_OFFLINE |
        FILE_ATTRIBUTE_RECALL_ON_OPEN |
        FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)) !==
    0
  );
}

/** Key for the attribute map: forward slashes, NFC, lower case. */
export const attributeKey = rel =>
  rel.replace(/\\/g, '/').normalize('NFC').toLowerCase();

/**
 * File attributes of every file below root (Windows only), by one PowerShell
 * call that reads metadata only. Returns null when they are not available.
 * @param {string} root
 * @returns {Map<string, number> | null}
 */
export function readAttributes(root) {
  if (process.platform !== 'win32') return null;
  const script = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    '$root = $env:KFBM_ROOT',
    'Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($root.Length).TrimStart(\'\\\') + "`t" + [int]$_.Attributes }',
  ].join('; ');
  const run = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, KFBM_ROOT: path.resolve(root) },
      maxBuffer: 256 * 1024 * 1024,
    }
  );
  if (run.error || run.status !== 0) return null;
  const map = new Map();
  for (const line of run.stdout.split(/\r?\n/)) {
    const tab = line.lastIndexOf('\t');
    if (tab < 0) continue;
    const value = Number(line.slice(tab + 1));
    if (Number.isFinite(value)) {
      map.set(attributeKey(line.slice(0, tab).replace(/^﻿/, '')), value);
    }
  }
  return map;
}

/**
 * Walks a folder and returns one entry per file: relative path (forward
 * slashes), size, modification time and attributes. Contents are never read.
 * @param {string} root
 * @param {{ attributes?: Map<string, number> | null }} [options]
 */
export function walkSource(root, { attributes = null } = {}) {
  const entries = [];
  const visit = dir => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        visit(full);
      } else if (item.isFile()) {
        const stat = statSync(full);
        const rel = path.relative(root, full).split(path.sep).join('/');
        const attr = attributes
          ? (attributes.get(attributeKey(rel)) ?? null)
          : null;
        entries.push({
          rel,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          attributes: attr,
          placeholder: isPlaceholderAttr(attr),
        });
      }
    }
  };
  visit(root);
  return entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/**
 * Names, sizes and times of the files of a folder next to the source (for the
 * duplicate check). Never reads contents. Returns an error text instead of
 * throwing when the folder cannot be listed.
 * @param {string} dir
 */
export function listFolder(dir) {
  try {
    return {
      files: walkSource(dir).map(e => ({
        rel: e.rel,
        size: e.size,
        mtimeMs: e.mtimeMs,
      })),
    };
  } catch (error) {
    return {
      files: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
