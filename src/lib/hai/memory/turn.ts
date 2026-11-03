/**
 * HAI memory in the chat turn: what the pipelines load before the model call and
 * what they propose after it. Both pipelines (processMessage and
 * processMessageStream, the spoken turn included, it is the same pipeline) call
 * these two functions and nothing else of the memory.
 *
 * Without the switch HAI_MEMORY both return at once, before any database call:
 * the prompt and the result are byte for byte the ones without memory.
 *
 * LOAD: only the confirmed entries of the user in the ONE occupation of the turn,
 * plus the approved shared entries for that occupation (and those for all). The
 * occupation is the single catalog of the access (the one chosen in the app). With
 * several occupations and no choice the turn has no single occupation: no entry of
 * the user is loaded (fail closed), only the shared entries for all occupations.
 * The switch of the user (off) loads nothing at all. Any failure means "no memory".
 *
 * PROPOSE: at most ONE question per conversation, never in a voice turn, never in
 * the middle of a quiz round, never when the user switched the memory off. A
 * statement of the user (memoryDetect) comes first, then a derived proposal about
 * weaknesses or the learning state (memoryDerive) at most once a week. The result
 * is a card with the buttons yes, no, change. Nothing acts before the yes.
 *
 * @module lib/hai/memory/turn
 */

import type { HaiPersona } from '../persona';
import type { RetrievalAccess } from '../retrievalAccess';
import { DERIVE_COOLDOWN_DAYS, isMemoryEnabled } from './config';
import { loadDeriveInputs, type DeriveInputs } from './deriveData';
import { dbGlobalMemoryRepo, dbUserMemoryRepo } from './repoDb';
import { loadApprovedGlobalTexts } from './globalStore';
import { detectMemoryCandidates } from './memoryDetect';
import { deriveCandidates } from './memoryDerive';
import {
  isDerivedRow,
  loadActiveUserMemories,
  proposeUserMemory,
} from './memoryStore';
import type { PromptMemory } from './promptSection';
import type {
  GlobalMemoryRepo,
  UserMemoryKind,
  UserMemoryRepo,
  UserMemorySource,
} from './repo';

/** Who the memory of a turn belongs to and in which occupation. */
export interface MemoryTurnScope {
  userId: string;
  /** The ONE occupation of the turn, null without a single occupation. */
  catalogId: string | null;
  /** All occupations of the user (the catalog scope of the server). */
  allowedCatalogIds: readonly string[];
  audience: 'trainer' | 'trainee';
  /** Names of other occupations to keep out of an entry (persona). */
  blockedWords: readonly string[];
}

/** The question that goes to the chat as a card (yes, no, change). */
export interface MemoryProposalPayload {
  id: string;
  kind: UserMemoryKind;
  source: UserMemorySource;
  content: string;
}

export interface MemoryTurnDeps {
  users: UserMemoryRepo;
  globals: GlobalMemoryRepo;
  loadDerive: (userId: string, catalogId: string) => Promise<DeriveInputs>;
  now: () => Date;
  /**
   * Remembers (per process) that the derivation just ran for a user and an
   * occupation, so a conversation without a new candidate does not run the two
   * queries on every message.
   */
  deriveGuard: { tried(key: string): boolean; mark(key: string): void };
}

/** How long (ms) a derivation without a result is not repeated in one process. */
const DERIVE_RETRY_MS = 30 * 60 * 1000;
const deriveTriedAt = new Map<string, number>();

const processDeriveGuard: MemoryTurnDeps['deriveGuard'] = {
  tried(key) {
    const at = deriveTriedAt.get(key);
    return at !== undefined && Date.now() - at < DERIVE_RETRY_MS;
  },
  mark(key) {
    if (deriveTriedAt.size > 2000) deriveTriedAt.clear();
    deriveTriedAt.set(key, Date.now());
  },
};

const defaultDeps: MemoryTurnDeps = {
  users: dbUserMemoryRepo,
  globals: dbGlobalMemoryRepo,
  loadDerive: loadDeriveInputs,
  now: () => new Date(),
  deriveGuard: processDeriveGuard,
};

/**
 * The scope of a turn from the server side access and persona, or null (no access,
 * neutral persona). The occupation is the single catalog of the access.
 */
export function memoryScopeFor(
  access: RetrievalAccess | null,
  persona: HaiPersona
): MemoryTurnScope | null {
  if (!access || persona.neutral || !access.userId) return null;
  const catalogIds = access.catalogIds ?? [];
  const blocked = [
    ...persona.foreignMarkers,
    ...persona.unselectedOwn.flatMap(own => own.markers),
  ];
  return {
    userId: access.userId,
    catalogId: catalogIds.length === 1 ? String(catalogIds[0]) : null,
    allowedCatalogIds: (access.allowedCatalogIds ?? catalogIds).map(String),
    audience: access.audience,
    blockedWords: blocked,
  };
}

/**
 * The memory for the prompt of one turn, or undefined (switch off, no scope, the
 * user switched it off, nothing stored, any failure).
 */
export async function loadMemoryForPrompt(
  scope: MemoryTurnScope | null,
  deps: MemoryTurnDeps = defaultDeps
): Promise<PromptMemory | undefined> {
  if (!isMemoryEnabled() || !scope) return undefined;
  try {
    if (!(await deps.users.getEnabled(scope.userId))) return undefined;
    const rows = scope.catalogId
      ? await loadActiveUserMemories(deps.users, scope.userId, scope.catalogId)
      : [];
    const global = await loadApprovedGlobalTexts(deps.globals, scope.catalogId);
    if (rows.length === 0 && global.length === 0) return undefined;
    return {
      user: rows.map(row => ({
        kind: row.kind,
        content: row.content,
        derived: isDerivedRow(row),
      })),
      global,
    };
  } catch (error) {
    console.warn(
      'HAI.ai memory: loading failed (no memory this turn):',
      error instanceof Error ? error.message : 'unknown error'
    );
    return undefined;
  }
}

export interface ProposeArgs {
  scope: MemoryTurnScope | null;
  message: string;
  sessionId?: string;
  /** The question was spoken: a card cannot be answered, so no proposal. */
  voice?: boolean;
  /** A quiz round is running (state or intent): never ask in the middle of it. */
  quizActive?: boolean;
}

/**
 * The proposal for this turn, stored with the status `proposed`, or null. At most
 * one per conversation (the answers of the session carry the id of an earlier one).
 */
export async function proposeMemoryForTurn(
  args: ProposeArgs,
  deps: MemoryTurnDeps = defaultDeps
): Promise<MemoryProposalPayload | null> {
  const { scope } = args;
  if (!isMemoryEnabled() || !scope || !scope.catalogId) return null;
  if (args.voice || args.quizActive || !args.sessionId) return null;
  const catalogId = scope.catalogId;

  try {
    if (!(await deps.users.getEnabled(scope.userId))) return null;
    if (await deps.users.sessionAskedMemory(args.sessionId)) return null;

    const tryPropose = async (
      kind: UserMemoryKind,
      key: string,
      content: string,
      source: UserMemorySource
    ): Promise<MemoryProposalPayload | null> => {
      const result = await proposeUserMemory(deps.users, {
        userId: scope.userId,
        catalogId,
        allowedCatalogIds: scope.allowedCatalogIds,
        kind,
        key,
        content,
        source,
        extraBlocked: scope.blockedWords,
      });
      if (!result.ok) return null;
      return {
        id: result.value.id,
        kind: result.value.kind,
        source: result.value.source,
        content: result.value.content,
      };
    };

    // 1. an explicit statement of the user about a preference
    for (const candidate of detectMemoryCandidates(args.message)) {
      const proposal = await tryPropose(
        candidate.kind,
        candidate.key,
        candidate.content,
        'stated'
      );
      if (proposal) return proposal;
    }

    // 2. derived from the quiz and progress data, trainees only, rarely
    if (scope.audience !== 'trainee') return null;
    const now = deps.now();
    const latest = await deps.users.latestDerivedAt(scope.userId, catalogId);
    if (
      latest &&
      now.getTime() - latest.getTime() < DERIVE_COOLDOWN_DAYS * 86_400_000
    ) {
      return null;
    }
    const guardKey = `${scope.userId}:${catalogId}`;
    if (deps.deriveGuard.tried(guardKey)) return null;
    deps.deriveGuard.mark(guardKey);
    const inputs = await deps.loadDerive(scope.userId, catalogId);
    for (const candidate of deriveCandidates(inputs, now)) {
      const proposal = await tryPropose(
        candidate.kind,
        candidate.key,
        candidate.content,
        'derived'
      );
      if (proposal) return proposal;
    }
    return null;
  } catch (error) {
    console.warn(
      'HAI.ai memory: proposal failed (no question this turn):',
      error instanceof Error ? error.message : 'unknown error'
    );
    return null;
  }
}
