// The path rule (stage 1 of the assignment, docs/ki-upload-konzept.md 6.1 and
// 6.2): type, component, enabler, quiz level and group from the relative path of
// an uploaded file, with the folder structure of the OneDrive source
// (Komponente/.../Enablers/<Enabler>/Quiz/..., Szenario, K<N>_Use-Cases,
// 00_Global_Quizze).
//
// Pure function: no file access, no database. It reuses pathInfo of the import
// as it is and adds three things: the limit on the input, the search for the
// group folder below parent folders of the upload, and the reading of a PDF as an
// original of the document type that its folder names.
//
// A path that does not follow the structure gives nothing, the rule never
// guesses: a loose file name, a foreign folder, a component folder without its
// group folder are all "none". A path that follows the structure only in part
// (a file name that does not fit its enabler folder) is a match that carries the
// issues of pathInfo, so the confidence can say so.

import { pathInfo } from '../../content-import/path-info';
import type { PathInfo } from '../../content-import/types';

import type {
  OriginalType,
  QuizLevelCode,
  SourceGroup,
  UploadDocType,
} from './types';

/**
 * Longest path that is read. The concept limits the stored path to 500
 * characters, a longer one is refused before a pattern sees it.
 */
export const MAX_PATH_CHARS = 1000;

export type PathNoneReason =
  | 'EMPTY_PATH'
  | 'PATH_TOO_LONG'
  | 'NO_STRUCTURE'
  | 'UNKNOWN_TYPE'
  | 'UNSUPPORTED_FORMAT';

export interface PathNone {
  kind: 'none';
  reason: PathNoneReason;
  /** The issues of pathInfo (fixed codes), for the review list. */
  issues: string[];
}

/** A file in an archive folder or with an archive name: left out. */
export interface PathArchive {
  kind: 'archive';
  componentCode: string | null;
  issues: string[];
}

export interface PathMatch {
  kind: 'match';
  docType: UploadDocType;
  /** For an original: the type of the document it is a copy of. */
  originalType: OriginalType | null;
  /** K6.2 */
  componentCode: string | null;
  /** 06.2 */
  componentKey: string | null;
  componentTitle: string | null;
  componentParagraph: string | null;
  /** K6.2-d */
  enablerCode: string | null;
  /** 6.2d */
  enablerKey: string | null;
  quizLevel: QuizLevelCode | null;
  /** Group of the folder; 'wahl' for K10 to K19 below part two. */
  group: SourceGroup | null;
  folderGroup: Exclude<SourceGroup, 'wahl'> | null;
  /** The content key of the import (quiz:1a:low, pdf:global-quiz:06.1). */
  contentKey: string | null;
  /** Version of a suffix like _v2 in the file name. */
  version: number | null;
  flags: string[];
  /** Why the path does not fully fit the scheme; empty for a clean path. */
  issues: string[];
  /** True when the group folder was found below parent folders. */
  rebased: boolean;
  /** A folder above the structure of the tree names an archive. */
  archiveAbove: boolean;
}

export type PathResult = PathNone | PathArchive | PathMatch;

const GROUP_FOLDER = [
  /^00_Global_Quizze$/i,
  /^Komponente\s+Teil\s*1\b/i,
  /^Komponente\s+Teil\s*2\b/i,
  /^Komponente\s*-\s*während der gesamten Ausbildung/i,
];

// Whole word markers only: a topic like "Archivierung" is not an archive. The
// same words as ARCHIVE_NAME in path-info.ts, which only looks at some places of
// the tree. Here every folder below the anchor and the file name count, so an
// archived version never competes with the current one.
const ARCHIVE_NAME = /(?:^|[\s_.-])(?:archiv|to_delete)(?:$|[\s_.-])/i;

const STRUCTURE_ISSUES = new Set([
  'unknown-group',
  'unknown-component-folder',
  'empty-path',
]);

const TYPE_OF: Record<string, OriginalType | undefined> = {
  enabler: 'enabler',
  quiz: 'quiz',
  scenario: 'scenario',
  'use-case': 'use_case',
  'global-quiz': 'global_quiz',
};

/** The path from the first group folder on, or null when there is none. */
function fromGroupFolder(path: string): string | null {
  const segments = path
    .split(/[\\/]+/)
    .map(segment => segment.normalize('NFC').trim());
  const index = segments.findIndex(segment =>
    GROUP_FOLDER.some(pattern => pattern.test(segment))
  );
  return index > 0 ? segments.slice(index).join('/') : null;
}

const none = (reason: PathNoneReason, issues: string[] = []): PathNone => ({
  kind: 'none',
  reason,
  issues,
});

function matchOf(
  info: PathInfo,
  docType: UploadDocType,
  originalType: OriginalType | null,
  rebased: boolean
): PathMatch {
  const component = info.component;
  const pdfOriginal = docType === 'pdf_original';
  const flags = [...info.flags];
  // pathInfo expects Word files, a PDF in the place of a Word file is an
  // original of that file and no format error
  let issues = [...info.issues];
  if (pdfOriginal) {
    issues = issues.filter(issue => issue !== 'unexpected-format');
    if (info.type !== 'pdf' && !flags.includes('pdf-original')) {
      flags.push('pdf-original');
    }
  }
  let contentKey = info.key;
  if (pdfOriginal && contentKey && !contentKey.startsWith('pdf:')) {
    contentKey = `pdf:${contentKey}`;
  }
  return {
    kind: 'match',
    docType,
    originalType,
    componentCode: component?.code ?? null,
    componentKey: component?.key ?? null,
    componentTitle: component?.title ?? null,
    componentParagraph: component?.paragraph ?? null,
    enablerCode: info.enablerCode,
    enablerKey: info.enablerKey,
    quizLevel:
      info.difficulty === 'low' ||
      info.difficulty === 'medium' ||
      info.difficulty === 'high'
        ? info.difficulty
        : null,
    group: info.group,
    folderGroup: info.folderGroup,
    contentKey,
    version: info.version,
    flags,
    issues,
    rebased,
    archiveAbove: false,
  };
}

/**
 * Metadata of an uploaded file from its relative path. Never throws. Accepts
 * both kinds of separators, drive letters and parent folders of the upload.
 */
export function classifyByPath(relPath: string): PathResult {
  if (typeof relPath !== 'string' || relPath.trim().length === 0) {
    return none('EMPTY_PATH');
  }
  if (relPath.length > MAX_PATH_CHARS) return none('PATH_TOO_LONG');

  let info = pathInfo(relPath);
  let rebased = false;
  let tree = relPath;
  if (info.issues.includes('unknown-group')) {
    const below = fromGroupFolder(relPath);
    if (below) {
      info = pathInfo(below);
      rebased = true;
      tree = below;
    }
  }
  const segments = tree
    .split(/[\\/]+/)
    .map(segment => segment.normalize('NFC').trim());
  const anchor = segments.findIndex(
    segment => segment.toLowerCase() === 'komponente'
  );
  const inTree = anchor >= 0 ? segments.slice(anchor + 1) : segments;

  if (
    info.type === 'archive' ||
    inTree.some(segment => ARCHIVE_NAME.test(segment))
  ) {
    return {
      kind: 'archive',
      componentCode: info.component?.code ?? null,
      issues: [...info.issues],
    };
  }
  if (info.issues.some(issue => STRUCTURE_ISSUES.has(issue))) {
    return none('NO_STRUCTURE', [...info.issues]);
  }
  const original = info.type === 'pdf' ? 'global_quiz' : TYPE_OF[info.type];
  if (!original) return none('UNKNOWN_TYPE', [...info.issues]);
  if (info.format !== 'docx' && info.format !== 'pdf') {
    return none('UNSUPPORTED_FORMAT', [...info.issues]);
  }
  // A folder above the structure is dropped by the anchor and by the search for
  // the group folder. If it names an archive the file is not skipped (the root
  // folder of an upload is often called so), but the caller is told.
  const all = relPath
    .split(/[\\/]+/)
    .map(segment => segment.normalize('NFC').trim());
  const archiveAbove = all
    .slice(0, Math.max(0, all.length - inTree.length))
    .some(segment => ARCHIVE_NAME.test(segment));
  const match =
    info.format === 'pdf'
      ? matchOf(info, 'pdf_original', original, rebased)
      : matchOf(info, original, null, rebased);
  return { ...match, archiveAbove };
}
