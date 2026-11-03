/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  loadMemoryForPrompt,
  memoryScopeFor,
  proposeMemoryForTurn,
  type MemoryTurnDeps,
  type MemoryTurnScope,
} from '@/lib/hai/memory/turn';
import { decideUserMemory } from '@/lib/hai/memory/memoryStore';
import { DERIVE_COOLDOWN_DAYS, MEMORY_ENV } from '@/lib/hai/memory/config';
import type { DeriveInputs } from '@/lib/hai/memory/deriveData';
import type { RetrievalAccess } from '@/lib/hai/retrievalAccess';
import type { HaiPersona } from '@/lib/hai/persona';
import {
  createGlobalRepo,
  createUserRepo,
  globalRow,
  userRow,
} from '../../../helpers/memoryHaiRepo';

// What the pipelines do with the memory in one turn: load before the model call
// (one occupation, only active entries, the switch of the user), propose after it
// (at most one per conversation, never in a quiz round or a voice turn, a
// rejected proposal never again). Without the switch HAI_MEMORY nothing happens.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ME = 'user-me';
const NOW = new Date('2026-11-03T09:00:00Z');

const scope = (over: Partial<MemoryTurnScope> = {}): MemoryTurnScope => ({
  userId: ME,
  catalogId: FIAE,
  allowedCatalogIds: [FIAE, KFBM],
  audience: 'trainee',
  blockedWords: [],
  ...over,
});

const EMPTY_DERIVE: DeriveInputs = { topics: [], progress: null };

function setup(
  options: {
    users?: ReturnType<typeof createUserRepo>;
    globals?: ReturnType<typeof createGlobalRepo>;
    derive?: DeriveInputs;
  } = {}
) {
  const users = options.users ?? createUserRepo();
  const globals = options.globals ?? createGlobalRepo();
  const loadDerive = jest.fn(async () => options.derive ?? EMPTY_DERIVE);
  const tried = new Set<string>();
  const deps: MemoryTurnDeps = {
    users,
    globals,
    loadDerive,
    now: () => NOW,
    deriveGuard: {
      tried: key => tried.has(key),
      mark: key => void tried.add(key),
    },
  };
  return { users, globals, loadDerive, deps };
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[MEMORY_ENV];
  process.env[MEMORY_ENV] = 'on';
});
afterEach(() => {
  if (saved === undefined) delete process.env[MEMORY_ENV];
  else process.env[MEMORY_ENV] = saved;
});

describe('memoryScopeFor', () => {
  const persona = {
    neutral: false,
    foreignMarkers: ['pflege'],
    unselectedOwn: [{ name: 'KfBM', markers: ['kfbm'] }],
  } as unknown as HaiPersona;
  const access = (over: Partial<RetrievalAccess> = {}): RetrievalAccess =>
    ({
      userId: ME,
      catalogIds: [FIAE],
      audience: 'trainee',
      organizationId: null,
      ...over,
    }) as RetrievalAccess;

  it('the occupation of the turn is the single catalog of the access', () => {
    expect(memoryScopeFor(access(), persona)).toEqual({
      userId: ME,
      catalogId: FIAE,
      allowedCatalogIds: [FIAE],
      audience: 'trainee',
      blockedWords: ['pflege', 'kfbm'],
    });
  });

  it('with a choice that narrowed the access the other occupations are only "allowed"', () => {
    const scoped = memoryScopeFor(
      access({ catalogIds: [FIAE], allowedCatalogIds: [FIAE, KFBM] }),
      persona
    );
    expect(scoped?.catalogId).toBe(FIAE);
    expect(scoped?.allowedCatalogIds).toEqual([FIAE, KFBM]);
  });

  it('with several occupations and no choice there is NO single occupation', () => {
    expect(
      memoryScopeFor(access({ catalogIds: [FIAE, KFBM] }), persona)?.catalogId
    ).toBeNull();
  });

  it('no scope without an access or with the neutral persona (fail closed)', () => {
    expect(memoryScopeFor(null, persona)).toBeNull();
    expect(
      memoryScopeFor(access(), { ...persona, neutral: true } as HaiPersona)
    ).toBeNull();
    expect(memoryScopeFor(access({ userId: '' }), persona)).toBeNull();
  });
});

describe('loadMemoryForPrompt', () => {
  it('without the switch nothing is read at all', async () => {
    delete process.env[MEMORY_ENV];
    const { users, globals, deps } = setup({
      users: createUserRepo([userRow({ userId: ME, trainingCatalogId: FIAE })]),
      globals: createGlobalRepo([globalRow()]),
    });
    expect(await loadMemoryForPrompt(scope(), deps)).toBeUndefined();
    expect(users.calls).toEqual([]);
    for (const value of ['', 'off', 'true', '1', 'ON ']) {
      process.env[MEMORY_ENV] = value;
      if (value.trim().toLowerCase() !== 'on') {
        expect(await loadMemoryForPrompt(scope(), deps)).toBeUndefined();
      }
    }
    expect(users.calls).toEqual([]);
    expect(globals.rows).toHaveLength(1);
  });

  it('loads the active entries of the ONE occupation and the approved shared ones', async () => {
    const { deps } = setup({
      users: createUserRepo([
        userRow({
          userId: ME,
          trainingCatalogId: FIAE,
          proposalKey: 'a',
          content: 'Antworten kurz halten.',
        }),
        userRow({
          userId: ME,
          trainingCatalogId: KFBM,
          proposalKey: 'b',
          content: 'Antworten ausführlich halten.',
        }),
        userRow({
          userId: ME,
          trainingCatalogId: FIAE,
          proposalKey: 'c',
          content: 'Noch offen.',
          status: 'proposed',
          confirmedAt: null,
        }),
        userRow({
          userId: ME,
          trainingCatalogId: FIAE,
          proposalKey: 'd',
          content: 'Abgelehnt.',
          status: 'rejected',
          confirmedAt: null,
        }),
        userRow({
          userId: 'someone-else',
          trainingCatalogId: FIAE,
          proposalKey: 'e',
          content: 'Fremd.',
        }),
      ]),
      globals: createGlobalRepo([
        globalRow({ trainingCatalogId: FIAE, content: 'Hinweis für A.' }),
        globalRow({ trainingCatalogId: KFBM, content: 'Hinweis für B.' }),
        globalRow({ trainingCatalogId: null, content: 'Hinweis für alle.' }),
      ]),
    });
    const memory = await loadMemoryForPrompt(scope(), deps);
    expect(memory?.user.map(e => e.content)).toEqual([
      'Antworten kurz halten.',
    ]);
    expect(memory?.global).toEqual(['Hinweis für A.', 'Hinweis für alle.']);

    const forB = await loadMemoryForPrompt(scope({ catalogId: KFBM }), deps);
    expect(forB?.user.map(e => e.content)).toEqual([
      'Antworten ausführlich halten.',
    ]);
    expect(forB?.global).toEqual(['Hinweis für B.', 'Hinweis für alle.']);
    // nothing of A is in the memory of B
    expect(JSON.stringify(forB)).not.toMatch(/kurz halten|für A/);
  });

  it('without a single occupation no entry of the user is loaded, only the shared ones for all', async () => {
    const { deps } = setup({
      users: createUserRepo([
        userRow({
          userId: ME,
          trainingCatalogId: FIAE,
          content: 'Antworten kurz halten.',
        }),
      ]),
      globals: createGlobalRepo([
        globalRow({ trainingCatalogId: FIAE, content: 'Hinweis für A.' }),
        globalRow({ trainingCatalogId: null, content: 'Hinweis für alle.' }),
      ]),
    });
    const memory = await loadMemoryForPrompt(scope({ catalogId: null }), deps);
    expect(memory?.user).toEqual([]);
    expect(memory?.global).toEqual(['Hinweis für alle.']);
  });

  it('the switch of the user (off) loads nothing at all, the shared entries included', async () => {
    const users = createUserRepo([
      userRow({ userId: ME, trainingCatalogId: FIAE }),
    ]);
    users.enabled.set(ME, false);
    const { deps } = setup({ users, globals: createGlobalRepo([globalRow()]) });
    expect(await loadMemoryForPrompt(scope(), deps)).toBeUndefined();
  });

  it('nothing stored, no scope, or a failing database gives no memory', async () => {
    const { deps, users } = setup();
    expect(await loadMemoryForPrompt(scope(), deps)).toBeUndefined();
    expect(await loadMemoryForPrompt(null, deps)).toBeUndefined();
    users.getEnabled = async () => {
      throw new Error('database down');
    };
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    expect(await loadMemoryForPrompt(scope(), deps)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('marks a weakness as derived (light check) and a typed entry as not', async () => {
    const { deps } = setup({
      users: createUserRepo([
        userRow({
          userId: ME,
          trainingCatalogId: FIAE,
          proposalKey: 'weak.e1',
          kind: 'weakness',
          source: 'derived',
          content: 'Tut sich beim Thema „Zugriffsrechte“ schwer.',
        }),
        userRow({
          userId: ME,
          trainingCatalogId: FIAE,
          proposalKey: 'pref.length.short',
        }),
      ]),
    });
    const memory = await loadMemoryForPrompt(scope(), deps);
    expect(memory?.user.map(e => [e.kind, e.derived])).toEqual(
      expect.arrayContaining([
        ['weakness', true],
        ['preference', false],
      ])
    );
  });
});

describe('proposeMemoryForTurn: statements of the user', () => {
  const args = (message: string, over: Record<string, unknown> = {}) => ({
    scope: scope(),
    message,
    sessionId: 'session-1',
    ...over,
  });

  it('a clear statement becomes a proposal (stored as proposed, no effect yet)', async () => {
    const { deps, users } = setup();
    const proposal = await proposeMemoryForTurn(
      args('Antworte bitte kürzer'),
      deps
    );
    expect(proposal).toMatchObject({
      kind: 'preference',
      source: 'stated',
      content: 'Bevorzugt kurze, knappe Antworten.',
    });
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]).toMatchObject({
      status: 'proposed',
      confirmedAt: null,
      trainingCatalogId: FIAE,
      proposalKey: 'pref.length.short',
    });
    expect(await loadMemoryForPrompt(scope(), deps)).toBeUndefined();
  });

  it('after the yes it acts', async () => {
    const { deps, users } = setup();
    const proposal = await proposeMemoryForTurn(
      args('Antworte bitte kürzer'),
      deps
    );
    await decideUserMemory(users, {
      userId: ME,
      id: proposal!.id,
      decision: 'confirm',
    });
    const memory = await loadMemoryForPrompt(scope(), deps);
    expect(memory?.user.map(e => e.content)).toEqual([
      'Bevorzugt kurze, knappe Antworten.',
    ]);
  });

  it('an uncertain case produces NO proposal', async () => {
    const { deps, users } = setup();
    for (const message of [
      'Wie antworte ich kürzer?',
      'Antworte nicht kürzer',
      'Vielleicht antworte ich kürzer',
      'Was ist ein Join?',
    ]) {
      expect(await proposeMemoryForTurn(args(message), deps)).toBeNull();
    }
    expect(users.rows).toHaveLength(0);
  });

  it('a rejected proposal is remembered and never comes back', async () => {
    const { deps, users } = setup();
    const first = await proposeMemoryForTurn(
      args('Antworte bitte kürzer'),
      deps
    );
    await decideUserMemory(users, {
      userId: ME,
      id: first!.id,
      decision: 'reject',
    });
    expect(
      await proposeMemoryForTurn(
        args('Antworte bitte kürzer', { sessionId: 'session-2' }),
        deps
      )
    ).toBeNull();
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0].status).toBe('rejected');
  });

  it('what is already active is not asked again', async () => {
    const users = createUserRepo([
      userRow({
        userId: ME,
        trainingCatalogId: FIAE,
        proposalKey: 'pref.length.short',
      }),
    ]);
    const { deps } = setup({ users });
    expect(
      await proposeMemoryForTurn(args('Antworte bitte kürzer'), deps)
    ).toBeNull();
    expect(users.rows).toHaveLength(1);
  });

  it('the next statement of the message is offered when the first is known', async () => {
    const users = createUserRepo([
      userRow({
        userId: ME,
        trainingCatalogId: FIAE,
        proposalKey: 'pref.length.short',
        status: 'rejected',
        confirmedAt: null,
      }),
    ]);
    const { deps } = setup({ users });
    const proposal = await proposeMemoryForTurn(
      args('Antworte kürzer und bitte duzen'),
      deps
    );
    expect(proposal?.content).toBe('Möchte mit Du angesprochen werden.');
  });

  it('at most ONE question per conversation', async () => {
    const { deps, users } = setup();
    users.askedSessions.add('session-1');
    expect(
      await proposeMemoryForTurn(args('Antworte bitte kürzer'), deps)
    ).toBeNull();
    expect(users.rows).toHaveLength(0);
  });

  it('never in the middle of a quiz round, never in a voice turn, never without a session', async () => {
    const { deps, users } = setup();
    expect(
      await proposeMemoryForTurn(
        args('Antworte bitte kürzer', { quizActive: true }),
        deps
      )
    ).toBeNull();
    expect(
      await proposeMemoryForTurn(
        args('Antworte bitte kürzer', { voice: true }),
        deps
      )
    ).toBeNull();
    expect(
      await proposeMemoryForTurn(
        args('Antworte bitte kürzer', { sessionId: undefined }),
        deps
      )
    ).toBeNull();
    expect(users.rows).toHaveLength(0);
  });

  it('the switch of the user (off): nothing is proposed', async () => {
    const { deps, users } = setup();
    users.enabled.set(ME, false);
    expect(
      await proposeMemoryForTurn(args('Antworte bitte kürzer'), deps)
    ).toBeNull();
    expect(users.rows).toHaveLength(0);
  });

  it('no occupation, no scope: nothing', async () => {
    const { deps, users } = setup();
    expect(
      await proposeMemoryForTurn(
        args('Antworte bitte kürzer', { scope: scope({ catalogId: null }) }),
        deps
      )
    ).toBeNull();
    expect(
      await proposeMemoryForTurn(
        args('Antworte bitte kürzer', { scope: null }),
        deps
      )
    ).toBeNull();
    expect(users.rows).toHaveLength(0);
  });

  it('without the switch HAI_MEMORY nothing happens, no database call', async () => {
    delete process.env[MEMORY_ENV];
    const { deps, users, loadDerive } = setup();
    expect(
      await proposeMemoryForTurn(args('Antworte bitte kürzer'), deps)
    ).toBeNull();
    expect(users.calls).toEqual([]);
    expect(loadDerive).not.toHaveBeenCalled();
  });

  it('a failure is no question and no error into the chat', async () => {
    const { deps, users } = setup();
    users.getEnabled = async () => {
      throw new Error('database down');
    };
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    expect(
      await proposeMemoryForTurn(args('Antworte bitte kürzer'), deps)
    ).toBeNull();
    warn.mockRestore();
  });

  it('the proposal is kept in the occupation of the turn (B gets its own)', async () => {
    const { deps, users } = setup();
    await proposeMemoryForTurn(args('Antworte bitte kürzer'), deps);
    await proposeMemoryForTurn(
      args('Antworte bitte kürzer', {
        scope: scope({ catalogId: KFBM }),
        sessionId: 'session-2',
      }),
      deps
    );
    expect(users.rows.map(r => r.trainingCatalogId).sort()).toEqual([
      FIAE,
      KFBM,
    ]);
  });
});

describe('proposeMemoryForTurn: derived proposals (weakness, learning state)', () => {
  const derive: DeriveInputs = {
    topics: [
      { enablerId: 'e1', title: 'Normalisierung', attempts: 3, avgScore: 30 },
    ],
    progress: { completed: 4, total: 20 },
  };
  const args = (over: Record<string, unknown> = {}) => ({
    scope: scope(),
    message: 'Was ist ein Join?',
    sessionId: 'session-1',
    ...over,
  });

  it('a trainee gets a weakness proposal derived from the quiz data, topic only', async () => {
    const { deps, loadDerive } = setup({ derive });
    const proposal = await proposeMemoryForTurn(args(), deps);
    expect(loadDerive).toHaveBeenCalledWith(ME, FIAE);
    expect(proposal).toMatchObject({ kind: 'weakness', source: 'derived' });
    expect(proposal?.content).toBe(
      'Tut sich beim Thema „Normalisierung“ schwer (Quizergebnisse unter 60 Prozent).'
    );
  });

  it('then the learning state, when the weakness is known', async () => {
    const users = createUserRepo([
      userRow({
        userId: ME,
        trainingCatalogId: FIAE,
        proposalKey: 'weak.e1',
        kind: 'weakness',
        source: 'derived',
        status: 'rejected',
        confirmedAt: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      }),
    ]);
    const { deps } = setup({ users, derive });
    const proposal = await proposeMemoryForTurn(args(), deps);
    expect(proposal).toMatchObject({ kind: 'learning_state' });
    expect(proposal?.content).toBe(
      'Lernstand am 03.11.2026: 4 von 20 Enablern abgeschlossen.'
    );
  });

  it('a rejected weakness never comes back', async () => {
    const users = createUserRepo([
      userRow({
        userId: ME,
        trainingCatalogId: FIAE,
        proposalKey: 'weak.e1',
        kind: 'weakness',
        source: 'derived',
        status: 'rejected',
        confirmedAt: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      }),
      userRow({
        userId: ME,
        trainingCatalogId: FIAE,
        proposalKey: 'state.progress',
        kind: 'learning_state',
        source: 'derived',
        status: 'rejected',
        confirmedAt: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      }),
    ]);
    const { deps } = setup({ users, derive });
    expect(await proposeMemoryForTurn(args(), deps)).toBeNull();
    expect(users.rows).toHaveLength(2);
  });

  it('asks for a derived entry at most once a week', async () => {
    const recent = new Date(
      NOW.getTime() - (DERIVE_COOLDOWN_DAYS - 1) * 86_400_000
    );
    const users = createUserRepo([
      userRow({
        userId: ME,
        trainingCatalogId: FIAE,
        proposalKey: 'weak.old',
        kind: 'weakness',
        source: 'derived',
        status: 'rejected',
        confirmedAt: null,
        createdAt: recent,
      }),
    ]);
    const { deps, loadDerive } = setup({ users, derive });
    expect(await proposeMemoryForTurn(args(), deps)).toBeNull();
    expect(loadDerive).not.toHaveBeenCalled();

    const older = new Date(
      NOW.getTime() - (DERIVE_COOLDOWN_DAYS + 1) * 86_400_000
    );
    users.rows[0].createdAt = older;
    expect(await proposeMemoryForTurn(args(), deps)).not.toBeNull();
  });

  it('does not run the derivation on every message of a conversation', async () => {
    const { deps, loadDerive } = setup({ derive: EMPTY_DERIVE });
    await proposeMemoryForTurn(args(), deps);
    await proposeMemoryForTurn(args(), deps);
    await proposeMemoryForTurn(args(), deps);
    expect(loadDerive).toHaveBeenCalledTimes(1);
  });

  it('a trainer gets no derived proposal (no learning state of his own)', async () => {
    const { deps, loadDerive, users } = setup({ derive });
    expect(
      await proposeMemoryForTurn(
        args({ scope: scope({ audience: 'trainer' }) }),
        deps
      )
    ).toBeNull();
    expect(loadDerive).not.toHaveBeenCalled();
    expect(users.rows).toHaveLength(0);
  });

  it('a statement comes before a derived proposal, and only one of them per turn', async () => {
    const { deps, users } = setup({ derive });
    const proposal = await proposeMemoryForTurn(
      args({ message: 'Antworte bitte kürzer' }),
      deps
    );
    expect(proposal?.kind).toBe('preference');
    expect(users.rows).toHaveLength(1);
  });

  it('never in a quiz round', async () => {
    const { deps, loadDerive } = setup({ derive });
    expect(
      await proposeMemoryForTurn(args({ quizActive: true }), deps)
    ).toBeNull();
    expect(loadDerive).not.toHaveBeenCalled();
  });

  it('nothing to derive: no proposal', async () => {
    const { deps } = setup({ derive: EMPTY_DERIVE });
    expect(await proposeMemoryForTurn(args(), deps)).toBeNull();
  });
});
