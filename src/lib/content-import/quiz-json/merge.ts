// Joins the files of the Word tree with the synthetic files of the quiz JSON.
// Pure function. The rule is simple and never silent:
//  - an enabler document of the Word tree always wins, the JSON only supplies an
//    enabler (title, no text) that the Word tree does not have
//  - a quiz or global quiz of the JSON that has the same content key as a usable
//    Word file is left out and listed as an older copy ("superseded"), unless
//    the caller asks for the JSON (preferJson) and the JSON set is free of
//    errors: then the Word files of that key are left out and listed instead
//  - a Word file that cannot be used (placeholder, read error, format error,
//    path that does not fit) does not hold its key: the JSON quiz fills the gap
//    and the Word file is listed as an older copy (the planner would otherwise
//    pick the Word file of the key and skip it, and the JSON quiz would be lost)
//  - everything else of the JSON is added
//  - component, group and title of a component that the Word tree has always
//    come from the Word tree
// What reaches the database is decided later by the engine, which leaves
// existing rows as they are unless --update-existing is given.

import type { SourceFile } from '../apply/plan';
import type { ImportPlan } from '../apply/types';
import type { QuizJsonRead, UnmappedSkip } from './types';

export interface MergeOptions {
  /** The JSON replaces the Word quiz of the same content key. */
  preferJson?: boolean;
  /** Component codes the run is limited to (K1, K6.2), empty for all. */
  limitedTo?: readonly string[];
}

export interface MergeResult {
  files: SourceFile[];
  /** Skip entries of quizzes that have no content key (for the plan). */
  skipped: Array<Omit<UnmappedSkip, 'componentCode'>>;
  /** Copies that lost against the other source, for the plan. */
  superseded: ImportPlan['superseded'];
  /** Numbers for the console: what came from the JSON and what was left out. */
  counts: {
    jsonQuizFiles: number;
    jsonEnablerFiles: number;
    leftOutForWord: number;
    replacedWord: number;
    filledForWord: number;
  };
}

const QUIZ_TYPES = new Set(['quiz', 'global-quiz']);

/** The planner can use this Word file (it has content and no format error). */
function usable(file: SourceFile): boolean {
  if (file.placeholder || file.readError || file.info.issues.length > 0) {
    return false;
  }
  const content = file.content;
  if (!content) return false;
  return content.type === 'enabler' || content.result.ok;
}

/** The JSON set is free of errors (the planner would not skip it). */
const clean = (file: SourceFile): boolean =>
  file.content !== undefined &&
  file.content.type !== 'enabler' &&
  file.content.result.ok;

export function mergeQuizSources(
  wordFiles: readonly SourceFile[],
  reads: readonly QuizJsonRead[],
  options: MergeOptions = {}
): MergeResult {
  const limited = new Set((options.limitedTo ?? []).map(c => c.toUpperCase()));
  const inScope = (componentCode: string | null) =>
    limited.size === 0 ||
    (componentCode !== null && limited.has(componentCode));

  const wordByKey = new Map<string, SourceFile[]>();
  // The component folders of the Word tree: group and title of a component
  // come from here, never from the JSON.
  const wordComponents = new Map<string, SourceFile>();
  for (const file of wordFiles) {
    const key = file.info.key;
    if (key) wordByKey.set(key, [...(wordByKey.get(key) ?? []), file]);
    const component = file.info.component;
    if (
      component &&
      file.info.folderGroup &&
      file.info.folderGroup !== 'global' &&
      component.title &&
      !wordComponents.has(component.code)
    ) {
      wordComponents.set(component.code, file);
    }
  }
  const adopt = (file: SourceFile): SourceFile => {
    const code = file.info.component?.code;
    const word = code ? wordComponents.get(code) : undefined;
    if (!word || !file.info.component || !word.info.component) return file;
    return {
      ...file,
      info: {
        ...file.info,
        folderGroup: word.info.folderGroup,
        group: word.info.group,
        component: {
          ...file.info.component,
          title: word.info.component.title,
          paragraph: word.info.component.paragraph,
        },
      },
    };
  };

  const files: SourceFile[] = [];
  const drop = new Set<SourceFile>();
  const superseded: ImportPlan['superseded'] = [];
  const counts = {
    jsonQuizFiles: 0,
    jsonEnablerFiles: 0,
    leftOutForWord: 0,
    replacedWord: 0,
    filledForWord: 0,
  };
  const jsonFiles: SourceFile[] = [];
  const skipped: MergeResult['skipped'] = [];
  for (const read of reads) {
    if (read.fatal) continue;
    for (const entry of read.unmapped) {
      if (inScope(entry.componentCode)) {
        skipped.push({
          file: entry.file,
          key: entry.key,
          type: entry.type,
          code: entry.code,
          reason: entry.reason,
        });
      }
    }
    jsonFiles.push(...read.files);
  }

  for (const file of jsonFiles) {
    if (!inScope(file.info.component?.code ?? null)) continue;
    const key = file.info.key;
    const same = key ? (wordByKey.get(key) ?? []) : [];
    if (file.info.type === 'enabler') {
      if (same.length === 0) {
        files.push(adopt(file));
        counts.jsonEnablerFiles += 1;
      }
      continue;
    }
    if (!QUIZ_TYPES.has(file.info.type) || same.length === 0) {
      files.push(adopt(file));
      counts.jsonQuizFiles += 1;
      continue;
    }
    const covered = same.every(usable);
    if (!covered) {
      // The Word files of this key cannot be used: the JSON quiz fills the gap.
      for (const word of same) {
        drop.add(word);
        superseded.push({
          file: word.rel,
          key: key as string,
          keptFile: file.rel,
        });
      }
      files.push(adopt(file));
      counts.jsonQuizFiles += 1;
      counts.filledForWord += 1;
    } else if (options.preferJson && clean(file)) {
      for (const word of same) {
        drop.add(word);
        superseded.push({
          file: word.rel,
          key: key as string,
          keptFile: file.rel,
        });
        counts.replacedWord += 1;
      }
      files.push(adopt(file));
      counts.jsonQuizFiles += 1;
    } else {
      superseded.push({
        file: file.rel,
        key: key as string,
        keptFile: same[0].rel,
      });
      counts.leftOutForWord += 1;
    }
  }

  return {
    files: [...wordFiles.filter(file => !drop.has(file)), ...files],
    skipped,
    superseded,
    counts,
  };
}
