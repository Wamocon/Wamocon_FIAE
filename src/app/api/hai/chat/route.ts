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
import { eq, and, desc, sql } from 'drizzle-orm';
import {
    haiChatSessions,
    haiChatMessages,
    profiles,
    enablers,
    courses
} from '@/db/migrations/schemas/schema';
import { processMessage, processMessageStream, PipelineContext, ChatMessage } from '@/lib/hai';
import { getProviderStatus } from '@/lib/hai/providers';

// ============================================================================
// TYPES
// ============================================================================

interface ChatRequestBody {
    message: string;
    sessionId?: string;
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
 * Get or create a chat session for the user
 */
async function getOrCreateSession(
    userId: string,
    contextType?: string,
    contextId?: string
): Promise<string> {
    // Try to find an active session with matching context
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

    // Create new session
    const newSession = await db
        .insert(haiChatSessions)
        .values({
            userId: userId,
            contextType: contextType || 'general',
            contextId: contextId || null,
            isActive: true,
        })
        .returning({ id: haiChatSessions.id });

    return newSession[0].id;
}

/**
 * Get previous messages for context
 */
async function getPreviousMessages(sessionId: string, limit: number = 10): Promise<ChatMessage[]> {
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
    return messages.reverse().map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
    }));
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

        // Verify user exists
        const user = await db
            .select({ id: profiles.id, role: profiles.role })
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
        const { message, sessionId: providedSessionId, context, stream = false } = body;

        // Validate message
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
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

        // Determine context type
        const contextType = context?.enablerId ? 'enabler' : context?.courseId ? 'course' : 'general';
        const contextId = context?.enablerId || context?.courseId || undefined;

        // Get or create session
        let sessionId: string;
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
                // Session doesn't exist or doesn't belong to user, create new one
                sessionId = await getOrCreateSession(userId, contextType, contextId);
            } else {
                sessionId = providedSessionId;
            }
        } else {
            sessionId = await getOrCreateSession(userId, contextType, contextId);
        }

        // Get previous messages for context
        const previousMessages = await getPreviousMessages(sessionId);

        // Get context titles
        const { enablerTitle, courseTitle } = await getContextTitles(
            context?.enablerId,
            context?.courseId
        );

        // Build pipeline context
        // Note: user[0].role available for future role-aware responses (Phase 1+)
        const pipelineContext: PipelineContext = {
            userId,
            sessionId,
            currentEnablerId: context?.enablerId,
            currentCourseId: context?.courseId,
            enablerTitle,
            courseTitle,
            scenarioText: context?.scenarioText,
            previousMessages,
        };

        // Save user message
        await saveMessage(sessionId, 'user', message.trim());

        // Handle streaming response
        if (stream) {
            const encoder = new TextEncoder();
            const readableStream = new ReadableStream({
                async start(controller) {
                    try {
                        const result = await processMessageStream(
                            message.trim(),
                            pipelineContext,
                            (chunk) => {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
                            }
                        );

                        // Save assistant response
                        await saveMessage(
                            sessionId,
                            'assistant',
                            result.response,
                            result.citations,
                            { intent: result.intent }
                        );

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
                        controller.enqueue(
                            encoder.encode(
                                `data: ${JSON.stringify({ error: 'Ein Fehler ist aufgetreten.' })}\n\n`
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

        // Save assistant response
        await saveMessage(
            sessionId,
            'assistant',
            result.response,
            result.citations,
            { intent: result.intent }
        );

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
        return NextResponse.json(
            { error: 'Ein interner Fehler ist aufgetreten. Bitte versuche es später erneut.' },
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
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
