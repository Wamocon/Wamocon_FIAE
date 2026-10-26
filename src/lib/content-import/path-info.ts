// Derives metadata from the path of a file of the KfBM source tree. Pure
// function: no file access, no database. The inventory script and the parse
// check use this one function, so both agree on what a file is.
//
// This module has no runtime import on purpose, the scripts under
// scripts/import load it directly with Node's type stripping.

import type {
  ComponentRef,
  Difficulty,
  PathInfo,
  SourceGroup,
  SourceType,
} from './types';

/** Component folder: "06.2 - Title (§ 4 Abs. 2 Nr. 6)". */
const COMPONENT_DIR =
  /^(\d{1,2})(?:\.(\d))?\s*-\s*(.+?)(?:\s*\((§[^)]*)\))?\s*$/;
/** Enabler id at the start of a folder or file name: 1a, 6d, 24_1a, 25.2d. */
const ENABLER_ID = /^(\d{1,2})(?:[_.](\d))?([a-z])(?![a-z0-9])/i;
const QUIZ_FILE =
  /^(\d{1,2})(?:[_.](\d))?([a-z])_Quiz_(Low|Medium|High)(?![a-z])/i;
const SCENARIO_FILE = /^Szenario_(\d{1,2})(?:[_.](\d))?([a-z])(?![a-z])/i;
const USE_CASE_FILE = /^UC_(\d{1,2})(?:[_.](\d))?([a-z])(?![a-z])/i;
const GLOBAL_QUIZ_FILE = /^(\d{1,2})(?:\.(\d))?_Global_Quiz/i;
// Whole word markers only: a topic like "Archivierung" is not an archive.
const ARCHIVE_NAME = /(?:^|[\s_.-])(?:archiv|to_delete)(?:$|[\s_.-])/i;

const pad2 = (n: number) => String(n).padStart(2, '0');

function normalizeSegment(raw: string): string {
  return raw.replace(/^﻿/, '').normalize('NFC').trim();
}

function splitPath(input: string): string[] {
  const parts = input
    .split(/[\\/]+/)
    .map(normalizeSegment)
    .filter(part => part.length > 0 && !/^[A-Za-z]:$/.test(part));
  const anchor = parts.findIndex(part => part.toLowerCase() === 'komponente');
  return anchor >= 0 ? parts.slice(anchor + 1) : parts;
}

function folderGroupOf(segment: string): PathInfo['folderGroup'] {
  if (/^00_Global_Quizze$/i.test(segment)) return 'global';
  if (/^Komponente\s+Teil\s*1\b/i.test(segment)) return 'teil1';
  if (/^Komponente\s+Teil\s*2\b/i.test(segment)) return 'teil2';
  if (/^Komponente\s*-\s*während der gesamten Ausbildung/i.test(segment))
    return 'ganze';
  return null;
}

function makeComponent(
  number: number,
  split: number | null,
  title: string | null,
  paragraph: string | null
): NonNullable<PathInfo['component']> {
  const ref: ComponentRef = {
    number,
    split,
    key: `${pad2(number)}${split !== null ? `.${split}` : ''}`,
    code: `K${number}${split !== null ? `.${split}` : ''}`,
    elective: number >= 10 && number <= 19,
    excluded: number === 18,
  };
  return { ...ref, title, paragraph };
}

function blank(format: string): PathInfo {
  return {
    group: null,
    folderGroup: null,
    component: null,
    enablerLetter: null,
    enablerKey: null,
    enablerCode: null,
    type: 'other',
    difficulty: null,
    format,
    version: null,
    key: null,
    flags: [],
    issues: [],
  };
}

function addIssue(info: PathInfo, issue: string) {
  if (!info.issues.includes(issue)) info.issues.push(issue);
}

function addFlag(info: PathInfo, flag: string) {
  if (!info.flags.includes(flag)) info.flags.push(flag);
}

function enablerKeyOf(
  number: number,
  split: number | null,
  letter: string
): string {
  return `${number}${split !== null ? `.${split}` : ''}${letter.toLowerCase()}`;
}

function setEnabler(info: PathInfo, key: string, letter: string) {
  const component = info.component;
  info.enablerLetter = letter.toLowerCase();
  info.enablerKey = key;
  info.enablerCode = component
    ? `${component.code}-${letter.toLowerCase()}`
    : null;
}

/** Component key (06.1, 24.2, 01) of a global quiz file name, otherwise null. */
export function globalQuizComponentKey(fileName: string): string | null {
  const base = normalizeSegment(fileName.split(/[\\/]/).pop() ?? '');
  const match = GLOBAL_QUIZ_FILE.exec(base);
  if (!match) return null;
  return `${pad2(Number(match[1]))}${match[2] ? `.${match[2]}` : ''}`;
}

/**
 * True when two enabler ids denote the same enabler. An id without a split
 * (6d) matches an id with one (6.2d) because many headings leave it out.
 */
export function enablerKeysMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const re = /^(\d{1,2})(?:\.(\d))?([a-z])$/i;
  const x = re.exec(a);
  const y = re.exec(b);
  if (!x || !y) return false;
  if (Number(x[1]) !== Number(y[1])) return false;
  if (x[3].toLowerCase() !== y[3].toLowerCase()) return false;
  return !x[2] || !y[2] || x[2] === y[2];
}

function finishGroup(info: PathInfo) {
  const component = info.component;
  info.group =
    component?.elective && info.folderGroup === 'teil2'
      ? 'wahl'
      : (info.folderGroup as SourceGroup | null);
}

function classifyGlobalQuiz(info: PathInfo, fileName: string) {
  const key = globalQuizComponentKey(fileName);
  if (!key) {
    info.type = 'other';
    addIssue(info, 'file-name-unrecognized');
    return;
  }
  const [num, split] = key.split('.');
  if (!info.component) {
    info.component = makeComponent(
      Number(num),
      split ? Number(split) : null,
      null,
      null
    );
  } else if (info.component.key !== key) {
    addIssue(info, 'component-mismatch');
  }
  if (info.format === 'pdf') {
    info.type = 'pdf';
    info.key = `pdf:global-quiz:${key}`;
  } else if (info.format === 'docx') {
    info.type = 'global-quiz';
    info.key = `global-quiz:${key}`;
  } else {
    info.type = 'other';
    addIssue(info, 'unexpected-format');
  }
}

function applyVersion(info: PathInfo, fileName: string) {
  const match = /_v(\d+)(?![A-Za-z0-9])/i.exec(fileName);
  if (match) {
    info.version = Number(match[1]);
    addFlag(info, 'version');
  }
}

/** Compares the id written in a file name with the id of the enabler folder. */
function checkFileId(
  info: PathInfo,
  match: RegExpExecArray | null,
  component: NonNullable<PathInfo['component']>
) {
  if (!match) return;
  const sameNumber = Number(match[1]) === component.number;
  const sameLetter = match[3].toLowerCase() === info.enablerLetter;
  const splitOk =
    !match[2] ||
    component.split === null ||
    Number(match[2]) === component.split;
  if (info.enablerLetter && !(sameNumber && sameLetter && splitOk)) {
    addIssue(info, 'letter-mismatch');
  }
}

function classifyEnablerArea(info: PathInfo, dirs: string[], fileName: string) {
  const component = info.component!;
  const folder = dirs[3];
  const folderId = folder ? ENABLER_ID.exec(folder) : null;

  if (folderId) {
    if (Number(folderId[1]) !== component.number) {
      addIssue(info, 'component-mismatch');
    } else if (
      folderId[2] &&
      component.split !== null &&
      Number(folderId[2]) !== component.split
    ) {
      addIssue(info, 'component-mismatch');
    }
    const key = enablerKeyOf(
      component.number,
      component.split ?? (folderId[2] ? Number(folderId[2]) : null),
      folderId[3]
    );
    setEnabler(info, key, folderId[3]);
  } else {
    addIssue(info, 'enabler-folder-unrecognized');
  }

  const sub = dirs[4];
  const fallbackId = (match: RegExpExecArray | null) => {
    // The folder gave no enabler id: use the one in the file name.
    if (!folderId && match) {
      const split = component.split ?? (match[2] ? Number(match[2]) : null);
      setEnabler(
        info,
        enablerKeyOf(Number(match[1]), split, match[3]),
        match[3]
      );
    }
  };

  if (sub && ARCHIVE_NAME.test(sub)) {
    info.type = 'archive';
    return;
  }
  if (!sub) {
    // A file right in the enabler folder.
    if (ARCHIVE_NAME.test(fileName)) {
      info.type = 'archive';
      return;
    }
    if (/^Szenario/i.test(fileName)) {
      const match = SCENARIO_FILE.exec(fileName);
      info.type = 'scenario';
      addFlag(info, 'misplaced');
      fallbackId(match);
      checkFileId(info, match, component);
      if (!match) addIssue(info, 'file-name-unrecognized');
      if (info.enablerKey && match) info.key = `scenario:${info.enablerKey}`;
      if (info.format !== 'docx') addIssue(info, 'unexpected-format');
      return;
    }
    const match = ENABLER_ID.exec(fileName);
    info.type = 'enabler';
    fallbackId(match);
    if (!match) addIssue(info, 'file-name-unrecognized');
    checkFileId(info, match, component);
    if (info.enablerKey) info.key = `enabler:${info.enablerKey}`;
    if (info.format !== 'docx') addIssue(info, 'unexpected-format');
    return;
  }
  if (dirs.length > 5) addIssue(info, 'unexpected-depth');
  if (/^Quiz$/i.test(sub)) {
    info.type = 'quiz';
    const match = QUIZ_FILE.exec(fileName);
    if (!match) {
      addIssue(info, 'file-name-unrecognized');
    } else {
      info.difficulty = match[4].toLowerCase() as Difficulty;
      fallbackId(match);
      checkFileId(info, match, component);
      if (info.enablerKey) {
        info.key = `quiz:${info.enablerKey}:${info.difficulty}`;
      }
    }
    if (info.format !== 'docx') addIssue(info, 'unexpected-format');
    return;
  }
  if (/^Szenario$/i.test(sub)) {
    info.type = 'scenario';
    let match = SCENARIO_FILE.exec(fileName);
    if (!match) {
      // A scenario named like its enabler ("14i.docx") in the Szenario folder.
      match = ENABLER_ID.exec(fileName);
      if (match) addFlag(info, 'name-variant');
    }
    if (!match) {
      addIssue(info, 'file-name-unrecognized');
    } else {
      fallbackId(match);
      checkFileId(info, match, component);
      if (info.enablerKey) info.key = `scenario:${info.enablerKey}`;
    }
    if (info.format !== 'docx') addIssue(info, 'unexpected-format');
    return;
  }
  info.type = 'other';
  addIssue(info, 'unexpected-folder');
}

function classifyUseCaseArea(info: PathInfo, dirs: string[], fileName: string) {
  const component = info.component!;
  const sub = dirs[3];
  if (sub && /^Enabler/i.test(sub)) {
    // An enabler text that lies in the use case folder.
    const match = ENABLER_ID.exec(fileName);
    info.type = 'enabler';
    addFlag(info, 'misplaced');
    if (!match) {
      addIssue(info, 'file-name-unrecognized');
    } else {
      const split = component.split ?? (match[2] ? Number(match[2]) : null);
      setEnabler(
        info,
        enablerKeyOf(Number(match[1]), split, match[3]),
        match[3]
      );
      if (Number(match[1]) !== component.number) {
        addIssue(info, 'component-mismatch');
      }
      info.key = `enabler:${info.enablerKey}`;
    }
    if (info.format !== 'docx') addIssue(info, 'unexpected-format');
    return;
  }
  const match = USE_CASE_FILE.exec(fileName);
  info.type = 'use-case';
  if (!match) {
    addIssue(info, 'file-name-unrecognized');
  } else {
    const split = component.split ?? (match[2] ? Number(match[2]) : null);
    setEnabler(info, enablerKeyOf(Number(match[1]), split, match[3]), match[3]);
    if (Number(match[1]) !== component.number) {
      addIssue(info, 'component-mismatch');
    }
    info.key = `use-case:${info.enablerKey}`;
  }
  if (info.format !== 'docx') addIssue(info, 'unexpected-format');
}

/**
 * Metadata of one file of the source tree, derived from its path alone.
 * Accepts relative paths below "Komponente" or absolute paths (everything up to
 * and including a folder named Komponente is dropped), with / or \.
 */
function classifyPath(path: string): PathInfo {
  const segments = splitPath(path ?? '');
  const fileName = segments[segments.length - 1] ?? '';
  const dirs = segments.slice(0, -1);
  const dot = fileName.lastIndexOf('.');
  const info = blank(dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '');

  if (segments.length === 0) {
    addIssue(info, 'empty-path');
    return info;
  }

  info.folderGroup = dirs.length > 0 ? folderGroupOf(dirs[0]) : null;
  if (!info.folderGroup) {
    addIssue(info, 'unknown-group');
    return info;
  }
  info.group = info.folderGroup;

  if (info.folderGroup === 'global') {
    if (/\.md$/i.test(fileName) && /Uebersicht|Übersicht/i.test(fileName)) {
      info.type = 'overview';
      info.key = 'overview';
      return info;
    }
    if (/^(Word|PDF)$/i.test(dirs[1] ?? '') && dirs.length === 2) {
      classifyGlobalQuiz(info, fileName);
      return info;
    }
    addIssue(info, 'file-name-unrecognized');
    return info;
  }

  const folder = dirs[1];
  const match = folder ? COMPONENT_DIR.exec(folder) : null;
  if (!match) {
    addIssue(info, 'unknown-component-folder');
    return info;
  }
  info.component = makeComponent(
    Number(match[1]),
    match[2] ? Number(match[2]) : null,
    match[3].trim(),
    match[4] ? match[4].trim() : null
  );
  finishGroup(info);

  const area = dirs[2];
  if (!area) {
    addIssue(info, 'unexpected-depth');
    return info;
  }
  if (/^Enablers?$/i.test(area)) {
    classifyEnablerArea(info, dirs, fileName);
  } else if (/^Global Quiz$/i.test(area)) {
    classifyGlobalQuiz(info, fileName);
  } else if (/^K\d+(?:\.\d)?_Use-?Cases?$/i.test(area)) {
    classifyUseCaseArea(info, dirs, fileName);
  } else {
    addIssue(info, 'unexpected-folder');
  }
  return info;
}

export function pathInfo(path: string): PathInfo {
  const info = classifyPath(path ?? '');
  const fileName = splitPath(path ?? '').pop() ?? '';
  if (info.key) applyVersion(info, fileName);
  return info;
}

export type { PathInfo, SourceGroup, SourceType };
