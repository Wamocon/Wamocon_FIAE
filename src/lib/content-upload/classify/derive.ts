// Mandatory or elective, phase and visibility of a file (docs/ki-upload-konzept.md
// 8.3). They are derived from the component and the document type with the
// presets of the import (scripts/import/kfbm-decisions.json), the one source that
// decideComponents in apply/plan.ts also uses. They are never chosen freely and
// never read from the content of a document.

import { kindOfComponent } from '../../content-import/apply/decisions';
import type {
  ComponentKind,
  Decisions,
} from '../../content-import/apply/types';

import type { OriginalType, SourceGroup, UploadDocType } from './types';

export type FactIssue =
  | 'COMPONENT_EXCLUDED'
  | 'NO_DECISION'
  | 'NO_GROUP'
  | 'KIND_GROUP_MISMATCH';

export interface ComponentFacts {
  /** Number of the component, null for something that is no component code. */
  number: number | null;
  /** pflicht, wahl or integrativ; null when the presets name none. */
  kind: ComponentKind | null;
  /** 1 or 2 for a mandatory component, otherwise null. */
  phase: 1 | 2 | null;
  /** The group the facts are derived for (the folder group or the list group). */
  group: Exclude<SourceGroup, 'global'> | null;
  /** The presets exclude the component (K18). */
  excluded: boolean;
  issues: FactIssue[];
}

const COMPONENT_CODE = /^K(\d{1,2})(?:\.\d)?$/;

/** The folder groups a component of a kind may lie in (as in apply/plan.ts). */
const GROUPS_OF_KIND: Record<ComponentKind, string[]> = {
  pflicht: ['teil1', 'teil2'],
  wahl: ['wahl'],
  integrativ: ['ganze'],
};

/**
 * Kind, phase and issues of a component by the presets. The group comes from
 * the folder of the path or from the row of the component in the database; the
 * group folder of the global quizzes counts for nothing. A kind that does not fit
 * the group is reported and not corrected (the dry run reports it as a conflict).
 */
export function deriveComponentFacts(
  decisions: Decisions,
  componentCode: string,
  group: SourceGroup | null | undefined
): ComponentFacts {
  const match = COMPONENT_CODE.exec(String(componentCode ?? '').trim());
  const effective = group && group !== 'global' ? group : null;
  if (!match) {
    return {
      number: null,
      kind: null,
      phase: null,
      group: effective,
      excluded: false,
      issues: ['NO_DECISION'],
    };
  }
  const number = Number(match[1]);
  const code = componentCode.trim();
  if (decisions.components.excludedNumbers.includes(number)) {
    return {
      number,
      kind: null,
      phase: null,
      group: effective,
      excluded: true,
      issues: ['COMPONENT_EXCLUDED'],
    };
  }
  const kind = kindOfComponent(decisions, number);
  if (!kind) {
    return {
      number,
      kind: null,
      phase: null,
      group: effective,
      excluded: false,
      issues: ['NO_DECISION'],
    };
  }
  const issues: FactIssue[] = [];
  let phase: 1 | 2 | null = null;
  if (effective && !GROUPS_OF_KIND[kind].includes(effective)) {
    issues.push('KIND_GROUP_MISMATCH');
  } else if (kind === 'pflicht') {
    if (code in decisions.components.phaseOverrides) {
      phase = decisions.components.phaseOverrides[code];
    } else if (effective === 'teil1' || effective === 'teil2') {
      phase = decisions.components.phaseByGroup[effective];
    } else {
      issues.push('NO_GROUP');
    }
  }
  return { number, kind, phase, group: effective, excluded: false, issues };
}

export interface Visibility {
  /** Parts that trainees may see. */
  trainee: string[];
  /** Solution parts, for trainers only. */
  trainerOnly: string[];
  /**
   * May the original file go to a public bucket? Only a file that trainees may
   * read whole may (concept 8.5): an enabler text and a whole scenario (decision of
   * the owner of 29.10.2026), never a quiz or a use case, whose task and model
   * solution are kept apart.
   */
  originalMayBePublic: boolean;
}

const VISIBILITY: Record<OriginalType, Visibility> = {
  enabler: { trainee: ['text'], trainerOnly: [], originalMayBePublic: true },
  quiz: {
    trainee: ['questions'],
    trainerOnly: ['correct_answer', 'rationale'],
    originalMayBePublic: false,
  },
  global_quiz: {
    trainee: ['questions'],
    trainerOnly: ['correct_answer', 'rationale'],
    originalMayBePublic: false,
  },
  // A scenario is one file, whole: trainees see the solution approach and the knowledge text
  // too (FIAE: exercise document, visibility ALL). Only a use case keeps a private solution.
  scenario: {
    trainee: [
      'situation',
      'task',
      'solution_scenario',
      'knowledge_contribution',
    ],
    trainerOnly: [],
    originalMayBePublic: true,
  },
  use_case: {
    trainee: ['topics', 'situation', 'objective', 'steps'],
    trainerOnly: ['model_solution', 'criteria'],
    originalMayBePublic: false,
  },
};

/**
 * What trainees see and what stays with trainers, by document type. An original
 * (PDF) is judged by the type of the document it is a copy of, an original of an
 * unknown type is never public.
 */
export function visibilityOf(
  docType: UploadDocType,
  originalType: OriginalType | null
): Visibility {
  const type = docType === 'pdf_original' ? originalType : docType;
  const base = type ? VISIBILITY[type] : null;
  if (!base) {
    return { trainee: [], trainerOnly: [], originalMayBePublic: false };
  }
  return {
    trainee: [...base.trainee],
    trainerOnly: [...base.trainerOnly],
    originalMayBePublic: base.originalMayBePublic,
  };
}
