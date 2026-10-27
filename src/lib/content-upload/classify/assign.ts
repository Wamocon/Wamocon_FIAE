// The rule stage of the assignment (stages 1 to 3 of docs/ki-upload-konzept.md
// 6.1 and the confidence table of 6.2): the path rule and the content rule are put
// together, checked against the positive list and given a band with the reasons
// that led to it. Pure function: no database, no network, no model.
//
// What a band means (the table of 6.2):
//   high      path and content name the same (0.99), or the content alone (0.95),
//             or the path alone (0.90), the code is on the list and unique, the
//             parser found no error. Only this band is pre selected in the review
//             list, and even that is only a pre selection: a person decides.
//   medium    something is not as clean: a heading variant or other warnings of
//             the parser (content alone), errors of the parser, a code that only
//             the plan of the folder tree would create, a path that the content
//             does not confirm, a file that was read only in part or not at all,
//             a marker word of a solution in a teaching text, a PDF recognized
//             by its content alone, an archive folder above the tree (0.70)
//   low       a type is known but the assignment is incomplete or not on the list
//             (0.50), a path with issues and no content to confirm it (0.50), or
//             nothing was recognized (0.00). Status "unclear".
//   conflict  path and content contradict each other, or the kind of the component
//             does not fit its folder group (0.30). Never goes to the model, a
//             conflict is a problem of the source that a person clears.
//
// A model proposal is never made here and never "high" (that is package U5). The
// content of a file can only make a proposal and cannot raise a band above what
// the path allows: when path and content differ the result is a conflict.
//
// Reasons carry stable codes and short German texts. They never quote the
// document: titles, questions and messages of the parsers stay out, only codes,
// type names and the codes of components and enablers go in.

import { enablerKeysMatch } from '../../content-import/path-info';
import type { Decisions } from '../../content-import/apply/types';
import type { Paragraph } from '../../content-import/types';

import {
  classifyByContent,
  type ContentMatch,
  type ContentResult,
} from './content-rule';
import {
  deriveComponentFacts,
  visibilityOf,
  type ComponentFacts,
  type Visibility,
} from './derive';
import { classifyByPath, type PathMatch, type PathResult } from './path-rule';
import type { PositiveList, Resolution } from './positive-list';
import {
  CONFIDENCE,
  REASON_TEXT_MAX,
  type AssignmentFields,
  type OriginalType,
  type ProposalBand,
  type ProposalSource,
  type QuizLevelCode,
  type Reason,
  type RuleFileStatus,
  type SourceGroup,
  type UploadDocType,
} from './types';

export interface AssignInput {
  /** The relative path as announced (webkitRelativePath), maybe only a file name. */
  relPath: string;
  /** From the extension of the path when left out. */
  format?: 'docx' | 'pdf';
  /**
   * The paragraphs of the file (readDocx), or the lines of the PDF text. Leave
   * out or pass null when the file was not read: then only the path counts.
   */
  paragraphs?: ReadonlyArray<Paragraph> | null;
  /**
   * What became of the reading: read (the default when paragraphs are given),
   * skipped (not tried) or failed (the reader refused or failed: the path alone
   * counts, but the band is capped at medium).
   */
  contentStatus?: 'read' | 'skipped' | 'failed';
  positiveList: PositiveList;
  decisions: Decisions;
}

/** One side of a conflict. */
export interface Alternative extends AssignmentFields {
  source: 'path' | 'content';
  originalType: OriginalType | null;
}

export interface RuleProposal extends AssignmentFields {
  originalType: OriginalType | null;
  /** Null when nothing was recognized. */
  source: ProposalSource | null;
  band: ProposalBand;
  /** 0 to 1, two decimals (content_upload_proposals.confidence). */
  confidence: number;
  /** False when no type was recognized at all. */
  recognized: boolean;
  /** Complete, on the positive list, with a decision about the component. */
  accepted: boolean;
  /** Component or enabler exists only in the plan of the folder tree. */
  isNew: boolean;
  fileStatus: RuleFileStatus;
  /** Why the file is unclear or skipped, otherwise null. */
  statusCode: string | null;
  reasons: Reason[];
  /** The rules that were applied, in order. */
  rules: string[];
  /** The content key (quiz:1a:low), null when the assignment is incomplete. */
  dupKey: string | null;
  group: Exclude<SourceGroup, 'global'> | null;
  facts: ComponentFacts | null;
  visibility: Visibility | null;
  /** The two readings of a conflict. */
  alternatives: Alternative[];
  /** The content of the file was evaluated. */
  contentRead: boolean;
  path: {
    kind: PathResult['kind'];
    flags: string[];
    issues: string[];
    version: number | null;
    rebased: boolean;
  };
  parser: { errors: string[]; warnings: string[] };
}

/** The columns of content_upload_proposals that the rule stage fills. */
export interface ProposalRow {
  source: ProposalSource;
  doc_type: UploadDocType | null;
  component_code: string | null;
  enabler_code: string | null;
  quiz_level: QuizLevelCode | null;
  confidence: number;
  band: ProposalBand;
  reasons: Reason[];
  model: null;
  is_current: true;
}

export type AssignedFields = AssignmentFields & {
  originalType: OriginalType | null;
};
type Fields = AssignedFields;

const TYPE_LABEL: Record<UploadDocType, string> = {
  enabler: 'Enabler-Lehrtext',
  quiz: 'Quiz',
  global_quiz: 'Global-Quiz',
  scenario: 'Szenario',
  use_case: 'Use Case',
  pdf_original: 'PDF-Original',
};
const LEVEL_LABEL: Record<QuizLevelCode, string> = {
  low: 'leicht',
  medium: 'mittel',
  high: 'anspruchsvoll',
};

const underlying = (f: {
  docType: UploadDocType | null;
  originalType: OriginalType | null;
}): OriginalType | null =>
  f.docType === 'pdf_original' ? f.originalType : f.docType;

const isComplete = (f: Fields): boolean => {
  const type = underlying(f);
  if (!f.docType || !type || !f.componentCode) return false;
  if (type !== 'global_quiz' && !f.enablerCode) return false;
  if (type === 'quiz' && !f.quizLevel) return false;
  return true;
};

const describeFields = (f: Fields): string => {
  if (!f.docType) return 'unbekannt';
  const type = underlying(f);
  const parts = [
    f.docType === 'pdf_original' && type
      ? `PDF-Original (${TYPE_LABEL[type]})`
      : TYPE_LABEL[f.docType],
  ];
  if (f.quizLevel) parts.push(LEVEL_LABEL[f.quizLevel]);
  if (f.enablerCode) parts.push(f.enablerCode);
  else if (f.componentCode) parts.push(f.componentCode);
  return parts.join(', ');
};

/** 'K6.2-d' to '6.2d', 'K6.1' to '06.1', the way the keys of the import are written. */
const enablerKeyOf = (code: string) =>
  /^K(\d{1,2})(?:\.(\d))?-([a-z])$/.exec(code)?.slice(1) ?? null;
const componentKeyOf = (code: string) =>
  /^K(\d{1,2})(?:\.(\d))?$/.exec(code)?.slice(1) ?? null;

/** The content key of a complete assignment, like PathInfo.key of the import. */
export function contentKeyOf(f: AssignedFields): string | null {
  if (!isComplete(f)) return null;
  const type = underlying(f) as OriginalType;
  let key: string | null = null;
  if (type === 'global_quiz') {
    const c = componentKeyOf(f.componentCode as string);
    key = c
      ? `global-quiz:${c[0].padStart(2, '0')}${c[1] ? `.${c[1]}` : ''}`
      : null;
  } else {
    const e = enablerKeyOf(f.enablerCode as string);
    if (e) {
      const id = `${e[0]}${e[1] ? `.${e[1]}` : ''}${e[2]}`;
      const name = type === 'use_case' ? 'use-case' : type;
      key = type === 'quiz' ? `quiz:${id}:${f.quizLevel}` : `${name}:${id}`;
    }
  }
  if (key === null) return null;
  return f.docType === 'pdf_original' ? `pdf:${key}` : key;
}

interface ContentFields extends Fields {
  resolution: Resolution | null;
}

function contentFields(
  c: ContentMatch,
  list: PositiveList,
  hintComponentCode: string | null
): ContentFields {
  const type = underlying(c);
  let componentCode: string | null = null;
  let enablerCode: string | null = null;
  let resolution: Resolution | null = null;
  if (c.headingKey && type) {
    if (type === 'global_quiz') {
      resolution = list.resolveComponentKey(c.headingKey);
      if (resolution.status === 'unique') {
        componentCode = resolution.componentCode;
      } else if (
        resolution.status === 'missing' &&
        c.componentNumber !== null
      ) {
        componentCode = `K${c.componentNumber}${
          c.componentSplit !== null ? `.${c.componentSplit}` : ''
        }`;
      }
    } else {
      resolution = list.resolveEnablerKey(c.headingKey, hintComponentCode);
      if (resolution.status === 'unique') {
        componentCode = resolution.componentCode;
        enablerCode = resolution.enablerCode ?? null;
      } else if (
        resolution.status === 'missing' &&
        c.componentNumber !== null &&
        c.enablerLetter
      ) {
        componentCode = `K${c.componentNumber}${
          c.componentSplit !== null ? `.${c.componentSplit}` : ''
        }`;
        enablerCode = `${componentCode}-${c.enablerLetter}`;
      }
    }
  }
  return {
    docType: c.docType,
    originalType: c.originalType,
    componentCode,
    enablerCode,
    quizLevel: type === 'quiz' ? c.quizLevel : null,
    resolution,
  };
}

const pathFields = (p: PathMatch): Fields => ({
  docType: p.docType,
  originalType: p.originalType,
  componentCode: p.componentCode,
  enablerCode: p.enablerCode,
  quizLevel:
    underlying({ docType: p.docType, originalType: p.originalType }) === 'quiz'
      ? p.quizLevel
      : null,
});

/** The codes of a list that can be shown in a reason. */
const codeList = (codes: readonly string[]) =>
  codes.filter(code => /^[A-Za-z0-9._-]{1,32}$/.test(code)).slice(0, 6);

const safeCodes = (codes: readonly string[], pattern: RegExp) =>
  codes.filter(code => pattern.test(code)).slice(0, 6);

interface Mismatch {
  code:
    | 'CONFLICT_TYPE'
    | 'CONFLICT_COMPONENT'
    | 'CONFLICT_ENABLER'
    | 'CONFLICT_LEVEL';
  text: string;
}

/** Where the two readings contradict each other. */
function mismatchesOf(
  p: PathMatch,
  c: ContentMatch,
  cf: ContentFields
): Mismatch[] {
  const out: Mismatch[] = [];
  if (p.docType !== c.docType || p.originalType !== c.originalType) {
    out.push({
      code: 'CONFLICT_TYPE',
      text: `Pfad und Inhalt widersprechen sich beim Typ: Pfad ${describeFields(pathFields(p))}, Inhalt ${describeFields(cf)}.`,
    });
    return out;
  }
  const type = underlying(p);
  const res = cf.resolution;
  if (type === 'global_quiz') {
    if (p.componentCode && c.headingKey) {
      const agrees =
        res?.status === 'unique'
          ? res.componentCode === p.componentCode
          : res?.status === 'ambiguous'
            ? res.candidates.includes(p.componentCode)
            : (() => {
                const own = componentKeyOf(p.componentCode as string);
                return (
                  !!own &&
                  c.componentNumber === Number(own[0]) &&
                  (c.componentSplit === null ||
                    c.componentSplit === Number(own[1] ?? NaN))
                );
              })();
      if (!agrees) {
        out.push({
          code: 'CONFLICT_COMPONENT',
          text: `Pfad und Inhalt widersprechen sich bei der Komponente: Pfad ${p.componentCode}, Inhalt ${cf.componentCode ?? 'mehrdeutig'}.`,
        });
      }
    }
  } else if (!p.enablerCode && p.componentCode && c.componentNumber !== null) {
    // the path names a component but no enabler (the folder or the file name
    // did not fit): the component of the heading must still be the same
    const own = componentKeyOf(p.componentCode);
    const agrees =
      !!own &&
      c.componentNumber === Number(own[0]) &&
      (c.componentSplit === null || c.componentSplit === Number(own[1] ?? NaN));
    if (!agrees) {
      out.push({
        code: 'CONFLICT_COMPONENT',
        text: `Pfad und Inhalt widersprechen sich bei der Komponente: Pfad ${p.componentCode}, Inhalt ${cf.componentCode ?? c.headingKey ?? 'unbekannt'}.`,
      });
    }
  } else if (p.enablerCode && c.headingKey) {
    const agrees =
      res?.status === 'unique'
        ? res.enablerCode === p.enablerCode
        : res?.status === 'ambiguous'
          ? res.candidates.includes(p.enablerCode)
          : enablerKeysMatch(c.headingKey, p.enablerKey);
    if (!agrees) {
      out.push({
        code: 'CONFLICT_ENABLER',
        text: `Pfad und Inhalt widersprechen sich beim Enabler: Pfad ${p.enablerCode}, Inhalt ${cf.enablerCode ?? c.headingKey}.`,
      });
    }
  }
  if (
    type === 'quiz' &&
    p.quizLevel &&
    c.quizLevel &&
    p.quizLevel !== c.quizLevel
  ) {
    out.push({
      code: 'CONFLICT_LEVEL',
      text: `Pfad und Inhalt widersprechen sich bei der Stufe: Pfad ${LEVEL_LABEL[p.quizLevel]}, Inhalt ${LEVEL_LABEL[c.quizLevel]}.`,
    });
  }
  return out;
}

const NONE_TEXT: Record<string, string> = {
  EMPTY_PATH: 'Es gibt keinen Pfad, die Pfadregel liefert nichts.',
  PATH_TOO_LONG: 'Der Pfad ist zu lang und wird nicht gelesen.',
  NO_STRUCTURE:
    'Der Pfad folgt nicht der Ordnerstruktur der Quelle, die Pfadregel liefert nichts.',
  UNKNOWN_TYPE:
    'Der Pfad nennt keinen bekannten Dokumenttyp, die Pfadregel liefert nichts.',
  UNSUPPORTED_FORMAT: 'Das Format ist weder Word noch PDF.',
};
const CONTENT_NONE_TEXT: Record<string, string> = {
  NO_TEXT: 'Die Datei enthält keinen lesbaren Text.',
  NO_STRUCTURE:
    'Der Inhalt zeigt keine bekannte Struktur eines Lehrdokuments, die Inhaltsregel liefert nichts.',
  QUESTION_FORMAT:
    'Die Datei hat das Format von Fragen mit Optionen, aber keinen Quizkopf.',
};

const nothing = (): Fields => ({
  docType: null,
  originalType: null,
  componentCode: null,
  enablerCode: null,
  quizLevel: null,
});

/**
 * Assigns a file by the rules: path rule, content rule, positive list, band and
 * reasons. Never throws.
 */
export function assignFile(input: AssignInput): RuleProposal {
  const reasons: Reason[] = [];
  const rules: string[] = ['path-rule'];
  const say = (code: string, text: string) => {
    reasons.push({
      code,
      text:
        text.length > REASON_TEXT_MAX ? text.slice(0, REASON_TEXT_MAX) : text,
    });
  };

  const relPath = typeof input.relPath === 'string' ? input.relPath : '';
  const format = input.format ?? (/\.pdf$/i.test(relPath) ? 'pdf' : 'docx');
  const list = input.positiveList;
  const path = classifyByPath(relPath);
  // A file that failed to read must not look like a file that was not tried:
  // its paragraphs are ignored and the band is capped (CONTENT_UNREADABLE).
  const unreadable = input.contentStatus === 'failed';
  const consulted =
    Array.isArray(input.paragraphs) &&
    !unreadable &&
    input.contentStatus !== 'skipped';
  const content: ContentResult | null = consulted
    ? classifyByContent(input.paragraphs as Paragraph[], { format })
    : null;
  if (consulted) rules.push('content-rule');

  const p = path.kind === 'match' ? path : null;
  const c = content?.kind === 'match' ? content : null;
  const pathSummary: RuleProposal['path'] = {
    kind: path.kind,
    flags: p ? p.flags : [],
    issues: [...path.issues],
    version: p ? p.version : null,
    rebased: p ? p.rebased : false,
  };
  const parserSummary = {
    errors: c ? [...c.parserErrors] : [],
    warnings: c ? [...c.parserWarnings] : [],
  };

  const result = (
    over: Partial<RuleProposal> & Pick<RuleProposal, 'band' | 'confidence'>
  ): RuleProposal => {
    const fields: Fields = {
      docType: over.docType ?? null,
      originalType: over.originalType ?? null,
      componentCode: over.componentCode ?? null,
      enablerCode: over.enablerCode ?? null,
      quizLevel: over.quizLevel ?? null,
    };
    return {
      ...fields,
      source: null,
      recognized: fields.docType !== null,
      accepted: false,
      isNew: false,
      fileStatus: over.band === 'low' ? 'unclear' : 'proposed_rules',
      statusCode: null,
      reasons,
      rules,
      dupKey: null,
      group: null,
      facts: null,
      visibility: fields.docType
        ? visibilityOf(fields.docType, fields.originalType)
        : null,
      alternatives: [],
      contentRead: consulted,
      path: pathSummary,
      parser: parserSummary,
      ...over,
    };
  };

  // An archive file is left out, whatever its content says.
  if (path.kind === 'archive') {
    say(
      'PATH_ARCHIVE',
      'Die Datei liegt in einem Archivordner und wird ausgelassen.'
    );
    return result({
      band: 'low',
      confidence: CONFIDENCE.none,
      fileStatus: 'skipped',
      statusCode: 'ARCHIVE_PATH',
      recognized: false,
    });
  }

  // 1. what the two rules found
  if (p) {
    say(
      'PATH_RULE',
      `Der Pfad nennt: ${describeFields(pathFields(p))}${p.contentKey ? ` (${p.contentKey})` : ''}.`
    );
    const issues = safeCodes(p.issues, /^[a-z-]{1,40}$/);
    if (issues.length > 0) {
      say(
        'PATH_ISSUES',
        `Der Pfad weicht vom Schema ab: ${issues.join(', ')}.`
      );
    }
  } else if (path.kind === 'none') {
    say('PATH_NONE', NONE_TEXT[path.reason] ?? NONE_TEXT.NO_STRUCTURE);
  }
  if (content?.kind === 'none') {
    say(
      'CONTENT_NONE',
      CONTENT_NONE_TEXT[content.reason] ?? CONTENT_NONE_TEXT.NO_STRUCTURE
    );
  }
  if (content && content.truncated) {
    say(
      'INPUT_TRUNCATED',
      'Eine sehr lange Datei wurde vor dem Lesen gekürzt.'
    );
  }
  const hint = p?.componentCode ?? null;
  // With the hint of the path to look for contradictions, without it to judge
  // what the content says on its own (a hint must not make a code unique that the
  // content alone leaves open).
  const cf = c ? contentFields(c, list, hint) : null;
  const cfFree = c ? contentFields(c, list, null) : null;
  if (c && cf && cfFree) {
    say(
      'CONTENT_RULE',
      `Überschrift und Struktur zeigen: ${describeFields(cfFree)}.`
    );
    if (c.skippedLeadingLines > 0) {
      say(
        'PDF_HEADER_SKIPPED',
        `Die PDF hat ${c.skippedLeadingLines} Kopfzeilen vor der Überschrift, sie wurden übergangen.`
      );
    }
  }

  // 2. do they agree
  const conflicts = p && c && cf ? mismatchesOf(p, c, cf) : [];
  if (p && c && cf && conflicts.length > 0) {
    rules.push('confidence-conflict');
    for (const m of conflicts) say(m.code, m.text);
    const typeAgrees = !conflicts.some(m => m.code === 'CONFLICT_TYPE');
    const componentAgrees =
      typeAgrees &&
      !conflicts.some(m => m.code === 'CONFLICT_COMPONENT') &&
      (underlying(p) === 'global_quiz' ||
        (p.enablerCode !== null &&
          cf.componentCode !== null &&
          cf.componentCode === p.componentCode));
    const keep: Fields = {
      docType: typeAgrees ? p.docType : null,
      originalType: typeAgrees ? p.originalType : null,
      componentCode: componentAgrees ? p.componentCode : null,
      enablerCode: null,
      quizLevel:
        typeAgrees && !conflicts.some(m => m.code === 'CONFLICT_LEVEL')
          ? pathFields(p).quizLevel
          : null,
    };
    if (
      typeAgrees &&
      underlying(p) !== 'global_quiz' &&
      !conflicts.some(m => m.code === 'CONFLICT_ENABLER')
    ) {
      keep.enablerCode = p.enablerCode;
    }
    return result({
      ...keep,
      recognized: true,
      source: 'path_content',
      band: 'conflict',
      confidence: CONFIDENCE.conflict,
      accepted: false,
      statusCode: null,
      alternatives: [
        { source: 'path', ...pathFields(p) },
        {
          source: 'content',
          docType: cf.docType,
          originalType: cf.originalType,
          componentCode: cf.componentCode,
          enablerCode: cf.enablerCode,
          quizLevel: cf.quizLevel,
        },
      ],
    });
  }

  // 3. which reading decides
  const pathClean = p !== null && p.issues.length === 0;
  const pathFieldsOf = p ? pathFields(p) : null;
  const contentComplete = cfFree !== null && isComplete(cfFree);
  let fields: Fields = nothing();
  let source: ProposalSource | null = null;
  let band: 'high' | 'medium' | 'low' = 'low';
  let confidence: number = CONFIDENCE.low;
  let statusCode: string | null = null;
  let resolvedOrigin: 'database' | 'plan' | null = null;

  const cap = (
    to: 'medium' | 'low',
    code: string,
    text: string,
    quiet = false
  ) => {
    const rank = { high: 3, medium: 2, low: 1 };
    if (!quiet) say(code, text);
    if (rank[to] < rank[band]) band = to;
    if (to === 'low') statusCode ??= code;
  };

  if (
    p &&
    c &&
    cfFree &&
    contentComplete &&
    pathClean &&
    pathFieldsOf &&
    isComplete(pathFieldsOf)
  ) {
    // both name the same
    fields = pathFieldsOf;
    source = 'path_content';
    band = 'high';
    confidence = CONFIDENCE.agree;
    rules.push('confidence-agree');
    say('AGREE', 'Pfad und Inhalt nennen dasselbe.');
  } else if (c && cfFree && contentComplete && (!p || !pathClean)) {
    // the content decides, alone or against a path with issues
    fields = cfFree;
    source = 'content';
    band = 'high';
    confidence = CONFIDENCE.content;
    rules.push('confidence-content');
    if (cfFree.resolution?.status === 'unique')
      resolvedOrigin = cfFree.resolution.origin;
    if (p) {
      cap(
        'medium',
        'PATH_ISSUES_IGNORED',
        'Der Pfad weicht vom Schema ab, deshalb zählt der Inhalt und der Vorschlag ist nur wahrscheinlich.'
      );
    }
  } else if (p && pathFieldsOf) {
    // the path decides, the content did not confirm it or was not read
    fields = pathFieldsOf;
    source = 'path';
    if (pathClean && isComplete(pathFieldsOf)) {
      if (
        consulted &&
        c &&
        cf &&
        isComplete(cf) &&
        cfFree?.resolution?.status === 'ambiguous'
      ) {
        // the content names the code of the path among several: it does not
        // contradict, but it does not confirm on its own either
        band = 'high';
        confidence = CONFIDENCE.path;
        rules.push('confidence-path');
        say(
          'CONTENT_AMBIGUOUS_COMPATIBLE',
          'Der Inhalt nennt einen Code, der zu mehreren Komponenten passt, und widerspricht dem Pfad nicht.'
        );
      } else if (consulted) {
        band = 'medium';
        confidence = CONFIDENCE.medium;
        rules.push('confidence-path-unconfirmed');
        say('CONTENT_UNCONFIRMED', 'Der Inhalt bestätigt den Pfad nicht.');
      } else {
        band = 'high';
        confidence = CONFIDENCE.path;
        rules.push('confidence-path');
        say(
          'CONTENT_NOT_READ',
          'Der Inhalt wurde nicht ausgewertet, es zählt nur der Pfad.'
        );
      }
    } else {
      band = 'low';
      if (!pathClean) statusCode = 'PATH_ISSUES';
      if (consulted && c) {
        say('CONTENT_UNCONFIRMED', 'Der Inhalt bestätigt den Pfad nicht.');
      }
    }
  } else if (c && cfFree) {
    // content only and not complete: the type is known
    fields = cfFree;
    source = 'content';
    band = 'low';
  }

  const recognized = fields.docType !== null;
  if (!recognized) {
    rules.push('confidence-none');
    return result({
      band: 'low',
      confidence: CONFIDENCE.none,
      source: consulted ? 'content' : 'path',
      recognized: false,
      statusCode:
        path.kind === 'none' && !consulted ? path.reason : 'NO_STRUCTURE',
    });
  }

  // 4. incomplete or ambiguous
  const res = cfFree?.resolution ?? null;
  if (
    res?.status === 'ambiguous' &&
    source !== 'path' &&
    source !== 'path_content'
  ) {
    cap(
      'low',
      'AMBIGUOUS_CODE',
      `Der Code passt zu mehreren Komponenten: ${codeList(res.candidates).join(', ')}.`
    );
  }
  if (!isComplete(fields) && res?.status !== 'ambiguous') {
    cap(
      'low',
      'INCOMPLETE',
      'Der Typ ist erkannt, aber Komponente, Enabler oder Stufe fehlen.'
    );
  }

  // 5. the positive list
  let accepted = false;
  let isNew = false;
  if (isComplete(fields)) {
    rules.push('positive-list');
    const component = list.component(fields.componentCode as string);
    const type = underlying(fields);
    const enabler =
      type === 'global_quiz'
        ? null
        : list.enabler(fields.enablerCode as string);
    const known =
      component !== null && (type === 'global_quiz' || enabler !== null);
    if (!known) {
      cap(
        'low',
        'NOT_IN_POSITIVE_LIST',
        `Komponente oder Enabler (${describeFields(fields)}) stehen nicht in der Positivliste.`
      );
    } else {
      const origin =
        resolvedOrigin ??
        (component.origin === 'plan' || enabler?.origin === 'plan'
          ? 'plan'
          : 'database');
      if (origin === 'plan') {
        isNew = true;
        accepted = true;
        cap(
          'medium',
          'NEW_IN_PLAN',
          'Komponente oder Enabler gibt es nur im Ordnerbaum, der Planbau legt sie neu an.'
        );
      } else {
        accepted = true;
        say(
          'IN_POSITIVE_LIST',
          'Komponente und Enabler stehen in der Positivliste.'
        );
      }
    }
  }

  // 6. warnings and errors of the parser
  if (c && c.headingVariant && source === 'content') {
    cap(
      'medium',
      'HEADING_VARIANT',
      'Die Überschrift hat eine andere Form als die Norm.'
    );
  } else if (c && c.headingVariant) {
    say(
      'HEADING_VARIANT',
      'Die Überschrift hat eine andere Form als die Norm.'
    );
  }
  if (
    c &&
    c.docType !== 'pdf_original' &&
    source === 'content' &&
    c.parserWarnings.some(code => code !== 'HEADING_VARIANT')
  ) {
    const warnings = safeCodes(
      c.parserWarnings.filter(code => code !== 'HEADING_VARIANT'),
      /^[A-Z_]{1,40}$/
    );
    cap(
      'medium',
      'PARSER_WARNINGS',
      `Der Parser meldet Hinweise zur Datei: ${warnings.join(', ')}.`
    );
  }
  if (c && c.solutionMarker) {
    cap(
      'medium',
      'SOLUTION_MARKER',
      'Im Lehrtext steht ein Wort, das einen Lösungsteil ankündigt. Die Datei ist nicht sicher frei von Lösungen.'
    );
  }
  if (source === 'content' && c && c.docType === 'pdf_original') {
    cap(
      'medium',
      'PDF_CONTENT_ONLY',
      'Eine PDF ohne passenden Pfad wird allein am Inhalt erkannt, ihre Kopfzeilen sind ungeprüft.'
    );
  }
  if (content && content.truncated) {
    cap(
      'medium',
      'INPUT_TRUNCATED',
      'Die Datei war so lang, dass sie nur zum Teil gelesen wurde.',
      true
    );
  }
  if (unreadable) {
    cap(
      'medium',
      'CONTENT_UNREADABLE',
      'Der Inhalt konnte nicht gelesen werden, es zählt nur der Pfad.'
    );
  }
  if (p && p.archiveAbove) {
    cap(
      'medium',
      'ARCHIVE_ABOVE_TREE',
      'Ein Ordner oberhalb der Struktur nennt ein Archiv, bitte prüfen.'
    );
  }
  if (path.kind === 'none' && path.reason === 'PATH_TOO_LONG') {
    cap(
      'low',
      'PATH_TOO_LONG',
      'Der Pfad ist zu lang, ein Archivordner darin wurde nicht geprüft.'
    );
  }
  // The text of a PDF has page headers and footers between its lines, so the
  // parsers always find fault with it. A PDF is an original that is attached to
  // a Word file, its errors say nothing about the file and do not count.
  if (c && c.docType !== 'pdf_original' && c.parserErrors.length > 0) {
    const errors = safeCodes(c.parserErrors, /^[A-Z_]{1,40}$/);
    cap(
      'medium',
      'PARSER_ERRORS',
      `Der Parser meldet Fehler in der Datei: ${errors.join(', ')}.`
    );
  }

  // 7. the facts of the component: kind, phase, group
  let facts: ComponentFacts | null = null;
  let group: RuleProposal['group'] = null;
  if (fields.componentCode) {
    const folderGroup = p && p.group && p.group !== 'global' ? p.group : null;
    const listGroup = list.component(fields.componentCode)?.group ?? null;
    // kind and folder are compared first (a mismatch is a conflict), then the
    // group of the database wins for the phase and a differing folder is noted
    facts = deriveComponentFacts(
      input.decisions,
      fields.componentCode,
      folderGroup ?? listGroup
    );
    if (
      folderGroup &&
      listGroup &&
      folderGroup !== listGroup &&
      !facts.issues.includes('KIND_GROUP_MISMATCH')
    ) {
      facts = deriveComponentFacts(
        input.decisions,
        fields.componentCode,
        listGroup
      );
      cap(
        'medium',
        'GROUP_FOLDER_MISMATCH',
        'Der Ordner nennt eine andere Gruppe als die Datenbank, die Datenbank gilt.'
      );
    }
    group = facts.group;
  }
  if (facts?.excluded) {
    say('COMPONENT_EXCLUDED', 'Die Komponente ist vom Import ausgeschlossen.');
    return result({
      ...fields,
      source,
      band: 'low',
      confidence: CONFIDENCE.none,
      recognized: true,
      accepted: false,
      fileStatus: 'skipped',
      statusCode: 'COMPONENT_EXCLUDED',
      facts,
      group,
      dupKey: contentKeyOf(fields),
    });
  }
  let conflict = false;
  for (const issue of facts?.issues ?? []) {
    if (issue === 'KIND_GROUP_MISMATCH') {
      conflict = true;
      say(
        'KIND_GROUP_MISMATCH',
        'Die Art der Komponente passt nicht zum Ordner der Gruppe.'
      );
    } else if (issue === 'NO_DECISION') {
      accepted = false;
      cap(
        'low',
        'NO_DECISION',
        'Für die Komponente gibt es keine Entscheidung in den Voreinstellungen.'
      );
    } else if (issue === 'NO_GROUP') {
      cap(
        'medium',
        'NO_GROUP',
        'Die Gruppe der Komponente ist unbekannt, die Phase lässt sich nicht ableiten.'
      );
    }
  }
  if (conflict) {
    rules.push('confidence-conflict');
    return result({
      ...fields,
      recognized: true,
      source,
      band: 'conflict',
      confidence: CONFIDENCE.conflict,
      accepted: false,
      facts,
      group,
      dupKey: null,
    });
  }

  const finalConfidence =
    band === 'high'
      ? confidence
      : band === 'medium'
        ? CONFIDENCE.medium
        : CONFIDENCE.low;
  return result({
    ...fields,
    source,
    band,
    confidence: finalConfidence,
    accepted: accepted && band !== 'low',
    isNew,
    statusCode: band === 'low' ? statusCode : null,
    facts,
    group,
    dupKey: contentKeyOf(fields),
  });
}

/**
 * The row for content_upload_proposals. The model column stays empty and the
 * source is never "ki": a proposal of the model is made by package U5.
 */
export function toProposalRow(proposal: RuleProposal): ProposalRow {
  return {
    source: proposal.source ?? (proposal.contentRead ? 'content' : 'path'),
    doc_type: proposal.docType,
    component_code: proposal.componentCode,
    enabler_code: proposal.enablerCode,
    quiz_level: proposal.quizLevel,
    confidence: proposal.confidence,
    band: proposal.band,
    reasons: proposal.reasons,
    model: null,
    is_current: true,
  };
}
