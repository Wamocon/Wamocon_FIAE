// PathInfo of a file that has no folder tree: built from the decision of a person
// (document type, component, enabler, quiz level) instead of from the path.
//
// The upload takes single files and folders without the structure of the source
// tree (docs/ki-upload-konzept.md, 8.1 point 1). The plan builder (plan.ts) only
// knows PathInfo, so the decision is turned into the same object that pathInfo()
// returns for a file at the right place. Pure function: no file access, no
// database, never throws. What cannot be derived ends up in `issues`, which the
// planner reports as a skipped file (PATH_ISSUE) instead of guessing.
//
// Nothing is read from the content of a file here. Title and paragraph of a
// component, and the folder group, come from the caller (the row of
// training_components, or the folder name of an upload that kept its tree).

import type { PathInfo, SourceGroup, SourceType } from '../types';

export type AssignmentDocType =
  | 'enabler'
  | 'quiz'
  | 'global_quiz'
  | 'scenario'
  | 'use_case';

export interface AssignmentComponentFacts {
  /** Title of the component, null when unknown (the planner then skips). */
  title: string | null;
  /** Paragraph of the regulation, for example "§ 4 Abs. 2 Nr. 6". */
  reference: string | null;
  /**
   * Group of the folder: teil1, teil2, ganze or wahl. For a mandatory component
   * of phase 1 that is teil1, of phase 2 teil2, an elective one wahl and an
   * integrative one ganze (the inverse of phaseByGroup and kindOfComponent).
   */
  group: SourceGroup | null;
}

export interface Assignment {
  docType: AssignmentDocType;
  /** K1, K6.2 */
  componentCode: string;
  /** K6.2-d. Not needed for a global quiz. */
  enablerCode: string | null;
  /** Only for a quiz. */
  quizLevel: 'low' | 'medium' | 'high' | null;
  /** File format without dot. Only docx is read by the plan builder. */
  format: string;
  /** Version of the file when the name carried one, otherwise null. */
  version?: number | null;
  component?: AssignmentComponentFacts | null;
}

const TYPE_OF: Record<AssignmentDocType, SourceType> = {
  enabler: 'enabler',
  quiz: 'quiz',
  global_quiz: 'global-quiz',
  scenario: 'scenario',
  use_case: 'use-case',
};

const COMPONENT_CODE = /^K(\d{1,2})(?:\.(\d))?$/;
const ENABLER_CODE = /^(K\d{1,2}(?:\.\d)?)-([a-z])$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

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

/** The group of the folder and the group of the plan for a group name. */
function groupsOf(group: SourceGroup | null | undefined): {
  folderGroup: PathInfo['folderGroup'];
  group: PathInfo['group'];
} {
  if (!group || group === 'global') return { folderGroup: null, group: null };
  // An elective component lies in the folder of part 2 and is told apart by its
  // number (finishGroup in path-info.ts).
  if (group === 'wahl') return { folderGroup: 'teil2', group: 'wahl' };
  return { folderGroup: group, group };
}

export function pathInfoFromAssignment(assignment: Assignment): PathInfo {
  const info = blank(String(assignment.format ?? '').toLowerCase());
  const type = TYPE_OF[assignment.docType];
  if (!type) {
    info.issues.push('unexpected-type');
    return info;
  }
  info.type = type;
  if (info.format !== 'docx') info.issues.push('unexpected-format');
  if (typeof assignment.version === 'number' && assignment.version >= 0) {
    info.version = assignment.version;
    info.flags.push('version');
  }

  const match = COMPONENT_CODE.exec(String(assignment.componentCode ?? ''));
  if (!match) {
    info.issues.push('component-code-invalid');
    return info;
  }
  const number = Number(match[1]);
  const split = match[2] ? Number(match[2]) : null;
  const facts = assignment.component ?? null;
  const groups = groupsOf(facts?.group);
  info.folderGroup = groups.folderGroup;
  info.group = groups.group;
  const key = `${pad2(number)}${split !== null ? `.${split}` : ''}`;
  info.component = {
    number,
    split,
    key,
    code: `K${number}${split !== null ? `.${split}` : ''}`,
    elective: number >= 10 && number <= 19,
    excluded: number === 18,
    title: facts?.title ?? null,
    paragraph: facts?.reference ?? null,
  };

  if (assignment.docType === 'global_quiz') {
    info.key = `global-quiz:${key}`;
    return info;
  }

  const enabler = ENABLER_CODE.exec(String(assignment.enablerCode ?? ''));
  if (!enabler) {
    info.issues.push('enabler-code-invalid');
    return info;
  }
  if (enabler[1] !== info.component.code) {
    // The enabler belongs to another component than the one named.
    info.issues.push('component-mismatch');
    return info;
  }
  const letter = enabler[2];
  const enablerKey = `${number}${split !== null ? `.${split}` : ''}${letter}`;
  info.enablerLetter = letter;
  info.enablerKey = enablerKey;
  info.enablerCode = assignment.enablerCode;

  if (assignment.docType === 'quiz') {
    if (!assignment.quizLevel) {
      info.issues.push('quiz-level-missing');
      return info;
    }
    info.difficulty = assignment.quizLevel;
    info.key = `quiz:${enablerKey}:${assignment.quizLevel}`;
  } else if (assignment.docType === 'use_case') {
    info.key = `use-case:${enablerKey}`;
  } else {
    info.key = `${assignment.docType}:${enablerKey}`;
  }
  return info;
}

/**
 * True when both describe the same content: type, key, component and enabler
 * code, level. Used to decide whether the PathInfo of a real path may be kept
 * (it carries the title and paragraph of the folder and the version) or the
 * decision of the person overrides it.
 */
export function sameContentInfo(a: PathInfo, b: PathInfo): boolean {
  return (
    a.type === b.type &&
    a.key !== null &&
    a.key === b.key &&
    a.component?.code === b.component?.code &&
    a.enablerCode === b.enablerCode &&
    a.difficulty === b.difficulty
  );
}
