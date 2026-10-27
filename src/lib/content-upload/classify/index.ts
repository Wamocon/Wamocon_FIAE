// The rule stage of the assignment (package U4 of docs/ki-upload-konzept.md):
// path rule, content rule, positive list, confidence and duplicate groups.
//
// Pure functions on paths, paragraphs and metadata: no file system, no database,
// no network, no model. The routes of U2, the review list of U6 and the transfer
// of U7 bind them in.

export {
  assignFile,
  contentKeyOf,
  toProposalRow,
  type Alternative,
  type AssignedFields,
  type AssignInput,
  type ProposalRow,
  type RuleProposal,
} from './assign';
export {
  classifyByContent,
  type ClassifyContentOptions,
  type ContentMatch,
  type ContentNone,
  type ContentResult,
} from './content-rule';
export {
  deriveComponentFacts,
  visibilityOf,
  type ComponentFacts,
  type FactIssue,
  type Visibility,
} from './derive';
export {
  analyzeDuplicates,
  versionOfPath,
  type DuplicateAnalysis,
  type DuplicateFile,
  type DuplicateOptions,
  type ExactGroup,
  type KeyGroup,
  type OriginalBinding,
  type SimilarFileGroup,
} from './duplicates';
export {
  classifyByPath,
  MAX_PATH_CHARS,
  type PathArchive,
  type PathMatch,
  type PathNone,
  type PathResult,
} from './path-rule';
export {
  buildPositiveList,
  positiveListFromPaths,
  type ComponentEntry,
  type EnablerEntry,
  type ListOrigin,
  type PositiveList,
  type PositiveListInput,
  type Resolution,
} from './positive-list';
export {
  DEFAULT_SIMILARITY,
  findSimilarDocuments,
  fingerprintOf,
  groupSimilarPairs,
  jaccardOf,
  normalizeForSimilarity,
  type Fingerprint,
  type SimilarGroup,
  type SimilarPair,
  type SimilarResult,
  type SimilarityOptions,
} from './similarity';
export {
  CONFIDENCE,
  REASON_TEXT_MAX,
  type AssignmentFields,
  type OriginalType,
  type ProposalBand,
  type ProposalSource,
  type QuizLevelCode,
  type Reason,
  type RuleFileStatus,
  type UploadDocType,
} from './types';
