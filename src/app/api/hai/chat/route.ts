/**
 * HAI.ai Chat API Route
 *
 * Main endpoint for chat interactions with HAI.ai.
 * Supports both regular and streaming responses.
 *
 * POST /api/hai/chat
 *
 * Request body:
 * {
 *   message: string;           // User's message
 *   sessionId?: string;        // Optional existing session ID
 *   context?: {
 *     enablerId?: string;      // Current enabler context
 *     courseId?: string;       // Current course context
 *     scenarioText?: string;   // Current scenario text
 *   };
 *   stream?: boolean;          // Enable streaming response
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import {
  haiChatSessions,
  haiChatMessages,
  profiles,
  enablers,
  courses,
} from '@/db/migrations/schemas/schema';
import {
  processMessage,
  processMessageStream,
  PipelineContext,
  ChatMessage,
} from '@/lib/hai';
import { getProviderStatus } from '@/lib/hai/providers';
import { buildHaiTrainingScope } from '@/lib/hai/trainingScope';
import { getUserOrgId, requireProPlan, toHaiRole } from '@/lib/auth-helpers';

// ============================================================================
// TYPES
// ============================================================================

interface ChatRequestBody {
  message: string;
  sessionId?: string;
  editMessageId?: string;
  context?: {
    enablerId?: string;
    courseId?: string;
    scenarioText?: string;
  };
  stream?: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a string is a valid UUID format
 */
function isValidUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Get or create a chat session for the user.
 *
 * When forceNew=true (default), ALWAYS creates a new session.
 * This prevents the old bug where "New Chat" would silently reuse
 * an existing active session with matching context.
 */
async function getOrCreateSession(
  userId: string,
  contextType?: string,
  contextId?: string,
  forceNew: boolean = true
): Promise<string> {
  if (!forceNew) {
    // Only used when explicitly continuing a context-linked session
    const existingSessions = await db
      .select({ id: haiChatSessions.id })
      .from(haiChatSessions)
      .where(
        and(
          eq(haiChatSessions.userId, userId),
          eq(haiChatSessions.isActive, true),
          contextType ? eq(haiChatSessions.contextType, contextType) : sql`1=1`,
          contextId ? eq(haiChatSessions.contextId, contextId) : sql`1=1`
        )
      )
      .limit(1);

    if (existingSessions.length > 0) {
      return existingSessions[0].id;
    }
  }

  // Create new session
  const organizationId = await getUserOrgId(userId);
  const newSession = await db
    .insert(haiChatSessions)
    .values({
      userId: userId,
      organizationId,
      contextType: contextType || 'general',
      contextId: contextId || null,
      isActive: true,
    })
    .returning({ id: haiChatSessions.id });

  return newSession[0].id;
}

/**
 * Get previous messages for context.
 *
 * Optimization: If session has a stored summary in metadata,
 * we use that instead of loading all older messages. This means
 * the LLM only sees: [summary] + [last N messages] + [new message].
 */
async function getPreviousMessages(
  sessionId: string,
  limit: number = 10
): Promise<{ messages: ChatMessage[]; summary?: string }> {
  // Check if session has a stored summary
  const session = await db
    .select({ metadata: haiChatSessions.metadata })
    .from(haiChatSessions)
    .where(eq(haiChatSessions.id, sessionId))
    .limit(1);

  const storedSummary =
    session.length > 0 &&
      session[0].metadata &&
      typeof session[0].metadata === 'object' &&
      'conversationSummary' in (session[0].metadata as Record<string, unknown>)
      ? ((session[0].metadata as Record<string, unknown>)
        .conversationSummary as string)
      : undefined;

  const messages = await db
    .select({
      role: haiChatMessages.role,
      content: haiChatMessages.content,
    })
    .from(haiChatMessages)
    .where(eq(haiChatMessages.sessionId, sessionId))
    .orderBy(desc(haiChatMessages.createdAt))
    .limit(limit);

  // Reverse to get chronological order and convert to ChatMessage format
  return {
    messages: messages.reverse().map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    })),
    summary: storedSummary,
  };
}

/**
 * Generate a lightweight conversation summary from messages.
 * Called every 10 messages to keep context compact.
 * This runs locally (no extra LLM call) — extracts key topics + factual statements.
 */
function generateLocalSummary(
  messages: ChatMessage[],
  previousSummary?: string
): string {
  const userMessages = messages
    .filter(m => m.role === 'user')
    .map(m => m.parts[0]?.text || '')
    .filter(t => t.length > 0);

  const topics = userMessages.map(msg => msg.slice(0, 80)).join(' | ');

  // Extract key factual statements from user messages (name mentions, claims, numbers)
  const keyFacts = extractKeyFacts(userMessages);

  const prefix = previousSummary
    ? `Vorheriger Kontext: ${previousSummary.slice(0, 200)}\n`
    : '';

  const factsStr =
    keyFacts.length > 0 ? `\nWichtige Aussagen: ${keyFacts.join('; ')}` : '';

  return `${prefix}Besprochene Themen: ${topics}${factsStr}`.slice(0, 600);
}

/**
 * Extract key factual statements from user messages.
 * Looks for names, numerical claims, relationships, and important declarations.
 * These facts are stored per-session and used for cross-session memory.
 */
function extractKeyFacts(userMessages: string[]): string[] {
  const facts: string[] = [];

  for (const msg of userMessages) {
    const lower = msg.toLowerCase();

    // Pattern: "ich habe X azubi(s)" / "mein azubi ist X" / "mein trainee"
    if (
      /\b(ich habe|mein|meine)\b.*(azubi|trainee|auszubildende|schueler)/i.test(
        msg
      )
    ) {
      facts.push(msg.slice(0, 120));
    }

    // Pattern: "mein name ist" / "ich bin" / "ich heisse"
    if (/\b(mein name|ich bin|ich hei[sß]e)\b/i.test(msg)) {
      facts.push(msg.slice(0, 100));
    }

    // Pattern: claims about trainees, grades, subjects
    if (
      /\b(note|klausur|pruefung|prüfung|lernfeld|enabler|projekt)\b/i.test(
        msg
      ) &&
      /\b(ist|hat|bekomm|schreib|arbeit)\b/i.test(msg)
    ) {
      facts.push(msg.slice(0, 120));
    }

    // Pattern: trainer mentions specific trainee names
    if (
      /\b(azubi|trainee|auszubildende)\b/i.test(msg) &&
      /\b(heisst|heißt|name|namens)\b/i.test(msg)
    ) {
      facts.push(msg.slice(0, 120));
    }

    // Pattern: "nur X" / "einzige(r)" — exclusive claims
    if (/\b(nur|einzige|einziger|allein|ausschliesslich)\b/i.test(msg)) {
      facts.push(msg.slice(0, 120));
    }

    // Pattern: schedule/time claims
    if (
      /\b(immer|jeden|jede woche|montag|dienstag|mittwoch|donnerstag|freitag)\b/i.test(
        lower
      ) &&
      lower.length < 150
    ) {
      facts.push(msg.slice(0, 120));
    }
  }

  // Deduplicate and limit
  const unique = [...new Set(facts)];
  return unique.slice(0, 8);
}

/**
 * Load cross-session memory for a user.
 * Queries summaries and key facts from the user's OTHER sessions
 * (excluding the current one) to provide long-term memory.
 *
 * This allows the AI to detect contradictions and reference past conversations.
 * Lightweight — only reads session metadata, not full message history.
 */
async function loadUserMemory(
  userId: string,
  currentSessionId: string
): Promise<string | undefined> {
  try {
    // Get recent sessions with their metadata (last 15 sessions, excluding current)
    const recentSessions = await db
      .select({
        id: haiChatSessions.id,
        title: haiChatSessions.title,
        metadata: haiChatSessions.metadata,
        createdAt: haiChatSessions.createdAt,
      })
      .from(haiChatSessions)
      .where(
        and(
          eq(haiChatSessions.userId, userId),
          eq(haiChatSessions.isActive, true),
          sql`${haiChatSessions.id} != ${currentSessionId}`
        )
      )
      .orderBy(desc(haiChatSessions.lastMessageAt))
      .limit(15);

    if (recentSessions.length === 0) return undefined;

    const memoryParts: string[] = [];

    for (const session of recentSessions) {
      if (!session.metadata || typeof session.metadata !== 'object') continue;

      const meta = session.metadata as Record<string, unknown>;
      const summary = meta.conversationSummary as string | undefined;

      if (!summary) continue;

      const sessionTitle = session.title || 'Untitled';
      const date = new Date(session.createdAt).toLocaleDateString('de-DE');
      memoryParts.push(`[${date} — "${sessionTitle}"]: ${summary}`);
    }

    if (memoryParts.length === 0) return undefined;

    // Cap total memory to avoid bloating the prompt
    return memoryParts.join('\n').slice(0, 1500);
  } catch (error) {
    console.warn('Failed to load user memory:', error);
    return undefined;
  }
}

/**
 * Save conversation summary and key facts to session metadata.
 * Called periodically (every 10 messages) to keep context efficient.
 * Also saves extracted key facts for cross-session memory.
 */
async function saveSessionSummary(
  sessionId: string,
  summary: string,
  keyFacts?: string[]
): Promise<void> {
  try {
    // Get existing metadata
    const session = await db
      .select({ metadata: haiChatSessions.metadata })
      .from(haiChatSessions)
      .where(eq(haiChatSessions.id, sessionId))
      .limit(1);

    const existingMetadata =
      session.length > 0 && session[0].metadata
        ? (session[0].metadata as Record<string, unknown>)
        : {};

    await db
      .update(haiChatSessions)
      .set({
        metadata: {
          ...existingMetadata,
          conversationSummary: summary,
          summaryUpdatedAt: new Date().toISOString(),
          ...(keyFacts && keyFacts.length > 0 ? { keyFacts } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(haiChatSessions.id, sessionId));
  } catch (error) {
    console.warn('Failed to save session summary:', error);
  }
}

/**
 * Get the total message count for a session (to decide when to summarize).
 */
async function getMessageCount(sessionId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(haiChatMessages)
    .where(eq(haiChatMessages.sessionId, sessionId));
  return Number(result[0]?.count || 0);
}

/**
 * Save a message to the database
 */
async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  citations: unknown[] = [],
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await db.insert(haiChatMessages).values({
    sessionId,
    role,
    content,
    citations: citations,
    metadata: metadata,
  });

  // Update session lastMessageAt so session list sorts by recency
  await db
    .update(haiChatSessions)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(haiChatSessions.id, sessionId));
}

/**
 * Update an existing assistant message in-place with new content.
 * Used during edit-regenerate to avoid creating duplicate messages.
 * Preserves the original createdAt so message order stays correct.
 */
async function updateAssistantMessage(
  messageId: string,
  content: string,
  citations: unknown[] = [],
  extraMeta: Record<string, unknown> = {}
): Promise<void> {
  // Read current metadata (which already has versions array with the new placeholder)
  const current = await db
    .select({ metadata: haiChatMessages.metadata })
    .from(haiChatMessages)
    .where(eq(haiChatMessages.id, messageId))
    .limit(1);

  const existingMeta =
    current.length > 0 &&
      current[0].metadata &&
      typeof current[0].metadata === 'object'
      ? (current[0].metadata as Record<string, unknown>)
      : {};

  // Update the last version entry with the actual content
  const versions = Array.isArray(existingMeta.versions)
    ? [
      ...(existingMeta.versions as Array<{
        content: string;
        citations: unknown[];
        createdAt: string;
      }>),
    ]
    : [];

  if (versions.length > 0) {
    versions[versions.length - 1] = {
      ...versions[versions.length - 1],
      content,
      citations,
    };
  }

  await db
    .update(haiChatMessages)
    .set({
      content,
      citations,
      metadata: {
        ...existingMeta,
        ...extraMeta,
        versions,
        activeVersionIndex: versions.length - 1,
      },
    })
    .where(eq(haiChatMessages.id, messageId));
}

/**
 * Get enabler and course titles for context
 */
async function getContextTitles(
  enablerId?: string,
  courseId?: string
): Promise<{ enablerTitle?: string; courseTitle?: string }> {
  let enablerTitle: string | undefined;
  let courseTitle: string | undefined;

  if (enablerId) {
    const enabler = await db
      .select({ title: enablers.title, courseId: enablers.courseId })
      .from(enablers)
      .where(eq(enablers.id, enablerId))
      .limit(1);

    if (enabler.length > 0) {
      enablerTitle = enabler[0].title;

      // Get course title from enabler's course
      if (enabler[0].courseId) {
        const course = await db
          .select({ title: courses.title })
          .from(courses)
          .where(eq(courses.id, enabler[0].courseId))
          .limit(1);

        if (course.length > 0) {
          courseTitle = course[0].title || undefined;
        }
      }
    }
  } else if (courseId) {
    const course = await db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);

    if (course.length > 0) {
      courseTitle = course[0].title || undefined;
    }
  }

  return { enablerTitle, courseTitle };
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    // Get user ID from request (passed by frontend after auth)
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert. Bitte melde dich an.' },
        { status: 401 }
      );
    }

    if (!(await requireProPlan(userId))) {
      return NextResponse.json(
        { error: 'HAI.ai is only available with a PRO subscription.' },
        { status: 403 }
      );
    }

    // Verify user exists
    const user = await db
      .select({
        id: profiles.id,
        role: profiles.role,
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (user.length === 0) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden.' },
        { status: 404 }
      );
    }

    // Parse request body
    const body: ChatRequestBody = await req.json();
    const {
      message,
      sessionId: providedSessionId,
      editMessageId,
      context,
      stream = false,
    } = body;

    // Validate message
    if (
      !message ||
      typeof message !== 'string' ||
      message.trim().length === 0
    ) {
      return NextResponse.json(
        { error: 'Nachricht darf nicht leer sein.' },
        { status: 400 }
      );
    }

    // Check message length
    if (message.length > 5000) {
      return NextResponse.json(
        { error: 'Nachricht ist zu lang. Maximum 5000 Zeichen.' },
        { status: 400 }
      );
    }

    if (editMessageId && !providedSessionId) {
      return NextResponse.json(
        { error: 'sessionId erforderlich fuer Edit-Weiterfuehrung.' },
        { status: 400 }
      );
    }

    // Validate editMessageId is a valid UUID (not a temporary client ID like "temp-...")
    // If it's not valid, treat this as a new message instead of an edit
    const isValidEdit = editMessageId && isValidUUID(editMessageId);
    const validEditMessageId = isValidEdit ? editMessageId : undefined;

    if (editMessageId && !isValidEdit) {
      console.warn(
        `[HAI] Ignoring invalid editMessageId (likely temporary client ID): ${editMessageId}`
      );
    }

    // Determine context type
    const contextType = context?.enablerId
      ? 'enabler'
      : context?.courseId
        ? 'course'
        : 'general';
    const contextId = context?.enablerId || context?.courseId || undefined;

    // Get or create session
    let sessionId: string;
    let isNewSession = false;
    if (providedSessionId) {
      // Verify session exists and belongs to user
      const existingSession = await db
        .select({ id: haiChatSessions.id })
        .from(haiChatSessions)
        .where(
          and(
            eq(haiChatSessions.id, providedSessionId),
            eq(haiChatSessions.userId, userId)
          )
        )
        .limit(1);

      if (existingSession.length === 0) {
        if (validEditMessageId) {
          return NextResponse.json(
            { error: 'Session nicht gefunden.' },
            { status: 404 }
          );
        }
        // Session doesn't exist or doesn't belong to user — create a fresh one
        sessionId = await getOrCreateSession(
          userId,
          contextType,
          contextId,
          true
        );
        isNewSession = true;
      } else {
        sessionId = providedSessionId;
      }
    } else {
      // No sessionId provided → ALWAYS create a new session (fixes the bleed bug)
      sessionId = await getOrCreateSession(
        userId,
        contextType,
        contextId,
        true
      );
      isNewSession = true;
    }

    // If this is an edit-regenerate, update the user message with version history
    // and find the existing assistant message to update in-place (not create new)
    let existingAssistantId: string | null = null;

    if (validEditMessageId) {
      const messageRecord = await db
        .select({
          messageId: haiChatMessages.id,
          role: haiChatMessages.role,
          content: haiChatMessages.content,
          sessionId: haiChatMessages.sessionId,
          metadata: haiChatMessages.metadata,
          createdAt: haiChatMessages.createdAt,
        })
        .from(haiChatMessages)
        .innerJoin(
          haiChatSessions,
          eq(haiChatMessages.sessionId, haiChatSessions.id)
        )
        .where(
          and(
            eq(haiChatMessages.id, validEditMessageId),
            eq(haiChatSessions.userId, userId),
            eq(haiChatMessages.sessionId, sessionId)
          )
        )
        .limit(1);

      if (messageRecord.length === 0) {
        return NextResponse.json(
          { error: 'Nachricht nicht gefunden.' },
          { status: 404 }
        );
      }

      if (messageRecord[0].role !== 'user') {
        return NextResponse.json(
          { error: 'Nur Nutzernachrichten koennen bearbeitet werden.' },
          { status: 400 }
        );
      }

      const existingMetadata =
        messageRecord[0].metadata &&
          typeof messageRecord[0].metadata === 'object'
          ? (messageRecord[0].metadata as Record<string, unknown>)
          : {};

      // Build user message version history in metadata
      const userVersions = Array.isArray(existingMetadata.versions)
        ? [
          ...(existingMetadata.versions as Array<{
            content: string;
            createdAt: string;
          }>),
        ]
        : [
          {
            content: messageRecord[0].content,
            createdAt: messageRecord[0].createdAt.toISOString(),
          },
        ];

      // Only add new version if content actually changed
      const lastUserVersion = userVersions[userVersions.length - 1];
      if (lastUserVersion.content !== message.trim()) {
        userVersions.push({
          content: message.trim(),
          createdAt: new Date().toISOString(),
        });
      }

      await db
        .update(haiChatMessages)
        .set({
          content: message.trim(),
          metadata: {
            ...existingMetadata,
            versions: userVersions,
            editedAt: new Date().toISOString(),
          },
        })
        .where(eq(haiChatMessages.id, validEditMessageId));

      // Update session lastMessageAt so session list sorts by recency
      await db
        .update(haiChatSessions)
        .set({ lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(haiChatSessions.id, sessionId));

      // Find the existing assistant message directly after this user message
      // so we can UPDATE it in-place instead of creating a duplicate
      const userCreatedAtISO = messageRecord[0].createdAt.toISOString();
      const assistantAfter = await db
        .select({
          id: haiChatMessages.id,
          content: haiChatMessages.content,
          citations: haiChatMessages.citations,
          metadata: haiChatMessages.metadata,
          createdAt: haiChatMessages.createdAt,
        })
        .from(haiChatMessages)
        .where(
          and(
            eq(haiChatMessages.sessionId, sessionId),
            eq(haiChatMessages.role, 'assistant'),
            sql`${haiChatMessages.createdAt} >= ${userCreatedAtISO}::timestamp`
          )
        )
        .orderBy(asc(haiChatMessages.createdAt))
        .limit(1);

      if (assistantAfter.length > 0) {
        existingAssistantId = assistantAfter[0].id;

        // Save old assistant content as version in its metadata
        const assistantMeta =
          assistantAfter[0].metadata &&
            typeof assistantAfter[0].metadata === 'object'
            ? (assistantAfter[0].metadata as Record<string, unknown>)
            : {};

        const assistantVersions = Array.isArray(assistantMeta.versions)
          ? [
            ...(assistantMeta.versions as Array<{
              content: string;
              citations: unknown[];
              createdAt: string;
            }>),
          ]
          : [
            {
              content: assistantAfter[0].content,
              citations: assistantAfter[0].citations || [],
              createdAt: assistantAfter[0].createdAt.toISOString(),
            },
          ];

        // Add empty placeholder for the new version (will be filled after streaming)
        assistantVersions.push({
          content: '',
          citations: [],
          createdAt: new Date().toISOString(),
        });

        await db
          .update(haiChatMessages)
          .set({
            metadata: {
              ...assistantMeta,
              versions: assistantVersions,
            },
          })
          .where(eq(haiChatMessages.id, existingAssistantId));
      }
    }

    // Get previous messages for context (with stored summary if available)
    const { messages: previousMessages, summary: storedSummary } =
      await getPreviousMessages(sessionId);

    // NOTE: Conversation summary is NO LONGER fetched here.
    // It was making an OpenRouter API call on every message (even "Hi"),
    // burning rate-limited API quota. The summary is only useful for
    // complex questions with >10 messages — those are handled inside
    // the pipeline only when the intent requires an actual LLM call.

    // Load cross-session memory (key facts + summaries from other chats)
    const crossSessionMemory = await loadUserMemory(userId, sessionId);

    // Get context titles
    const { enablerTitle, courseTitle } = await getContextTitles(
      context?.enablerId,
      context?.courseId
    );

    // Build pipeline context (Phase 1: pass userRole for live data context)
    const userRole = toHaiRole(user[0].role);
    const pipelineContext: PipelineContext = {
      userId,
      sessionId,
      currentEnablerId: context?.enablerId,
      currentCourseId: context?.courseId,
      enablerTitle,
      courseTitle,
      scenarioText: context?.scenarioText,
      previousMessages,
      // Privileged roles (ADMIN, TEMP_ADMIN) act as TRAINER so they receive
      // full trainer-level context and live data branches in the RAG pipeline.
      userRole,
      conversationSummary: storedSummary,
      crossSessionMemory,
      trainingScope: buildHaiTrainingScope({
        role: userRole,
        startOfTrainingDate: user[0].startOfTrainingDate,
        ausbildungDurationYears: user[0].ausbildungDurationYears,
      }),
    };

    // Save user message (skip if we are editing an existing message)
    if (!validEditMessageId) {
      await saveMessage(sessionId, 'user', message.trim());
    }

    // Handle streaming response
    if (stream) {
      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            const result = await processMessageStream(
              message.trim(),
              pipelineContext,
              chunk => {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`)
                );
              }
            );

            // Save assistant response — UPDATE existing or INSERT new
            if (validEditMessageId && existingAssistantId) {
              await updateAssistantMessage(
                existingAssistantId,
                result.response,
                result.citations,
                { intent: result.intent }
              );
            } else {
              await saveMessage(
                sessionId,
                'assistant',
                result.response,
                result.citations,
                { intent: result.intent }
              );
            }

            // Auto-set title for new sessions using user's first message (no API call)
            if (isNewSession) {
              const autoTitle =
                message.trim().slice(0, 60) +
                (message.trim().length > 60 ? '...' : '');
              db.update(haiChatSessions)
                .set({
                  title: autoTitle,
                  lastMessageAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(haiChatSessions.id, sessionId))
                .catch(() => { });
            }

            // Periodically generate and save conversation summary (every 10 messages)
            const msgCount = await getMessageCount(sessionId);
            if (msgCount > 0 && msgCount % 10 === 0) {
              const allMsgs = await getPreviousMessages(sessionId, 20);
              const allUserTexts = allMsgs.messages
                .filter(m => m.role === 'user')
                .map(m => m.parts[0]?.text || '')
                .filter(t => t.length > 0);
              const facts = extractKeyFacts(allUserTexts);
              const summary = generateLocalSummary(
                allMsgs.messages,
                storedSummary
              );
              saveSessionSummary(sessionId, summary, facts).catch(() => { });
            } else if (msgCount <= 4) {
              // Early fact extraction for new sessions — save key facts
              // immediately so cross-session memory works from the start
              const earlyMsgs = await getPreviousMessages(sessionId, 10);
              const earlyTexts = earlyMsgs.messages
                .filter(m => m.role === 'user')
                .map(m => m.parts[0]?.text || '')
                .filter(t => t.length > 0);
              const earlyFacts = extractKeyFacts(earlyTexts);
              if (earlyFacts.length > 0) {
                const earlySummary = generateLocalSummary(earlyMsgs.messages);
                saveSessionSummary(sessionId, earlySummary, earlyFacts).catch(
                  () => { }
                );
              }
            }

            // Send final event with metadata
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  done: true,
                  sessionId,
                  citations: result.citations,
                  intent: result.intent,
                })}\n\n`
              )
            );
            controller.close();
          } catch (error) {
            console.error('HAI.ai stream error:', error);
            const lang = req.headers.get('x-language') || 'de';
            const errorMsg = lang === 'en'
              ? 'An internal error occurred. Please try again later.'
              : 'Ein interner Fehler ist aufgetreten. Bitte versuche es später erneut.';

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: errorMsg })}\n\n`
              )
            );
            controller.close();
          }
        },
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Non-streaming response
    const result = await processMessage(message.trim(), pipelineContext);

    // Save assistant response — UPDATE existing or INSERT new
    if (validEditMessageId && existingAssistantId) {
      await updateAssistantMessage(
        existingAssistantId,
        result.response,
        result.citations,
        { intent: result.intent }
      );
    } else {
      await saveMessage(
        sessionId,
        'assistant',
        result.response,
        result.citations,
        { intent: result.intent }
      );
    }

    // Auto-set title for new sessions using user's first message (no API call)
    if (isNewSession) {
      const autoTitle =
        message.trim().slice(0, 60) + (message.trim().length > 60 ? '...' : '');
      db.update(haiChatSessions)
        .set({
          title: autoTitle,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(haiChatSessions.id, sessionId))
        .catch(() => { });
    }

    // Periodically generate and save conversation summary (every 10 messages)
    const msgCountNonStream = await getMessageCount(sessionId);
    if (msgCountNonStream > 0 && msgCountNonStream % 10 === 0) {
      const allMsgsNonStream = await getPreviousMessages(sessionId, 20);
      const allUserTextsNS = allMsgsNonStream.messages
        .filter(m => m.role === 'user')
        .map(m => m.parts[0]?.text || '')
        .filter(t => t.length > 0);
      const factsNS = extractKeyFacts(allUserTextsNS);
      const summaryNonStream = generateLocalSummary(
        allMsgsNonStream.messages,
        storedSummary
      );
      saveSessionSummary(sessionId, summaryNonStream, factsNS).catch(() => { });
    } else if (msgCountNonStream <= 4) {
      // Early fact extraction for new sessions
      const earlyMsgsNS = await getPreviousMessages(sessionId, 10);
      const earlyTextsNS = earlyMsgsNS.messages
        .filter(m => m.role === 'user')
        .map(m => m.parts[0]?.text || '')
        .filter(t => t.length > 0);
      const earlyFactsNS = extractKeyFacts(earlyTextsNS);
      if (earlyFactsNS.length > 0) {
        const earlySummaryNS = generateLocalSummary(earlyMsgsNS.messages);
        saveSessionSummary(sessionId, earlySummaryNS, earlyFactsNS).catch(
          () => { }
        );
      }
    }

    return NextResponse.json({
      success: true,
      sessionId,
      response: result.response,
      citations: result.citations,
      intent: result.intent,
      quizState: result.quizState,
    });
  } catch (error) {
    console.error('HAI.ai chat error:', error);
    const lang = req.headers.get('x-language') || 'de';
    const errorMsg = lang === 'en'
      ? 'An internal error occurred. Please try again later.'
      : 'Ein interner Fehler ist aufgetreten. Bitte versuche es später erneut.';

    return NextResponse.json(
      {
        error: errorMsg,
        errorKey: 'hai.error.somethingWrong'
      },
      { status: 500 }
    );
  }
}

// Update a user message content (edit)
export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert. Bitte melde dich an.' },
        { status: 401 }
      );
    }

    if (!(await requireProPlan(userId))) {
      return NextResponse.json(
        { error: 'HAI.ai is only available with a PRO subscription.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { messageId, content } = body as {
      messageId?: string;
      content?: string;
    };

    if (!messageId || !content || !content.trim()) {
      return NextResponse.json(
        { error: 'messageId und content erforderlich.' },
        { status: 400 }
      );
    }

    // Verify message belongs to user (via session) and is a user message
    const messageRecord = await db
      .select({
        messageId: haiChatMessages.id,
        role: haiChatMessages.role,
        sessionId: haiChatMessages.sessionId,
        metadata: haiChatMessages.metadata,
      })
      .from(haiChatMessages)
      .innerJoin(
        haiChatSessions,
        eq(haiChatMessages.sessionId, haiChatSessions.id)
      )
      .where(
        and(
          eq(haiChatMessages.id, messageId),
          eq(haiChatSessions.userId, userId)
        )
      )
      .limit(1);

    if (messageRecord.length === 0) {
      return NextResponse.json(
        { error: 'Nachricht nicht gefunden.' },
        { status: 404 }
      );
    }

    if (messageRecord[0].role !== 'user') {
      return NextResponse.json(
        { error: 'Nur Nutzernachrichten koennen bearbeitet werden.' },
        { status: 400 }
      );
    }

    const existingMetadata =
      messageRecord[0].metadata && typeof messageRecord[0].metadata === 'object'
        ? (messageRecord[0].metadata as Record<string, unknown>)
        : {};

    await db
      .update(haiChatMessages)
      .set({
        content: content.trim(),
        metadata: {
          ...existingMetadata,
          editedAt: new Date().toISOString(),
        },
      })
      .where(eq(haiChatMessages.id, messageId));

    // Touch session lastMessageAt + updatedAt
    await db
      .update(haiChatSessions)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(haiChatSessions.id, messageRecord[0].sessionId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('HAI.ai chat edit error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten.' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  if (!(await requireProPlan(userId))) {
    return NextResponse.json(
      { error: 'HAI.ai is only available with a PRO subscription.' },
      { status: 403 }
    );
  }

  try {
    // Get user's recent sessions
    const sessions = await db
      .select({
        id: haiChatSessions.id,
        title: haiChatSessions.title,
        contextType: haiChatSessions.contextType,
        isActive: haiChatSessions.isActive,
        lastMessageAt: haiChatSessions.lastMessageAt,
        createdAt: haiChatSessions.createdAt,
      })
      .from(haiChatSessions)
      .where(eq(haiChatSessions.userId, userId))
      .orderBy(desc(haiChatSessions.lastMessageAt))
      .limit(20);

    // Include provider status for diagnostics
    let providerInfo;
    try {
      providerInfo = getProviderStatus();
    } catch {
      providerInfo = null;
    }

    return NextResponse.json({
      success: true,
      sessions,
      providers: providerInfo,
    });
  } catch (error) {
    console.error('HAI.ai sessions error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
