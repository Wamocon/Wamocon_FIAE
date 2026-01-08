/**
 * HAI.ai Session API Route
 * 
 * Endpoint for managing chat sessions.
 * Users can view, continue, and manage their chat history.
 * 
 * GET /api/hai/session - List sessions
 * GET /api/hai/session?sessionId=xxx - Get single session with messages
 * PATCH /api/hai/session - Update session (title, archive)
 * DELETE /api/hai/session - Delete session
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import {
    haiChatSessions,
    haiChatMessages,
    profiles
} from '@/db/migrations/schemas/schema';

// ============================================================================
// TYPES
// ============================================================================

interface UpdateSessionBody {
    sessionId: string;
    title?: string;
    isActive?: boolean;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * GET - List sessions or get single session with messages
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');
        const sessionId = searchParams.get('sessionId');
        const includeArchived = searchParams.get('includeArchived') === 'true';
        const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
        const offset = parseInt(searchParams.get('offset') || '0');

        if (!userId) {
            return NextResponse.json(
                { error: 'Nicht authentifiziert.' },
                { status: 401 }
            );
        }

        // Verify user exists
        const user = await db
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (user.length === 0) {
            return NextResponse.json(
                { error: 'Benutzer nicht gefunden.' },
                { status: 404 }
            );
        }

        // Single session with messages
        if (sessionId) {
            // Get session
            const session = await db
                .select({
                    id: haiChatSessions.id,
                    title: haiChatSessions.title,
                    contextType: haiChatSessions.contextType,
                    contextId: haiChatSessions.contextId,
                    quizState: haiChatSessions.quizState,
                    isActive: haiChatSessions.isActive,
                    createdAt: haiChatSessions.createdAt,
                    lastMessageAt: haiChatSessions.lastMessageAt,
                })
                .from(haiChatSessions)
                .where(
                    and(
                        eq(haiChatSessions.id, sessionId),
                        eq(haiChatSessions.userId, userId)
                    )
                )
                .limit(1);

            if (session.length === 0) {
                return NextResponse.json(
                    { error: 'Session nicht gefunden.' },
                    { status: 404 }
                );
            }

            // Get messages
            const messages = await db
                .select({
                    id: haiChatMessages.id,
                    role: haiChatMessages.role,
                    content: haiChatMessages.content,
                    citations: haiChatMessages.citations,
                    createdAt: haiChatMessages.createdAt,
                })
                .from(haiChatMessages)
                .where(eq(haiChatMessages.sessionId, sessionId))
                .orderBy(asc(haiChatMessages.createdAt));

            return NextResponse.json({
                success: true,
                session: session[0],
                messages,
            });
        }

        // List all sessions
        let query = db
            .select({
                id: haiChatSessions.id,
                title: haiChatSessions.title,
                contextType: haiChatSessions.contextType,
                contextId: haiChatSessions.contextId,
                isActive: haiChatSessions.isActive,
                createdAt: haiChatSessions.createdAt,
                lastMessageAt: haiChatSessions.lastMessageAt,
            })
            .from(haiChatSessions)
            .where(
                includeArchived
                    ? eq(haiChatSessions.userId, userId)
                    : and(
                        eq(haiChatSessions.userId, userId),
                        eq(haiChatSessions.isActive, true)
                    )
            )
            .orderBy(desc(haiChatSessions.lastMessageAt))
            .limit(limit)
            .offset(offset);

        const sessions = await query;

        // Get total count
        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(haiChatSessions)
            .where(
                includeArchived
                    ? eq(haiChatSessions.userId, userId)
                    : and(
                        eq(haiChatSessions.userId, userId),
                        eq(haiChatSessions.isActive, true)
                    )
            );

        const totalCount = Number(countResult[0]?.count || 0);

        // Get message count for each session
        const sessionsWithCount = await Promise.all(
            sessions.map(async (s) => {
                const msgCount = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(haiChatMessages)
                    .where(eq(haiChatMessages.sessionId, s.id));
                return {
                    ...s,
                    messageCount: Number(msgCount[0]?.count || 0),
                };
            })
        );

        return NextResponse.json({
            success: true,
            sessions: sessionsWithCount,
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: offset + sessions.length < totalCount,
            },
        });
    } catch (error) {
        console.error('HAI.ai session list error:', error);
        return NextResponse.json(
            { error: 'Ein interner Fehler ist aufgetreten.' },
            { status: 500 }
        );
    }
}

/**
 * PATCH - Update session (rename, archive)
 */
export async function PATCH(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json(
                { error: 'Nicht authentifiziert.' },
                { status: 401 }
            );
        }

        const body: UpdateSessionBody = await req.json();
        const { sessionId, title, isActive } = body;

        if (!sessionId) {
            return NextResponse.json(
                { error: 'sessionId erforderlich.' },
                { status: 400 }
            );
        }

        // Verify session belongs to user
        const session = await db
            .select({ id: haiChatSessions.id })
            .from(haiChatSessions)
            .where(
                and(
                    eq(haiChatSessions.id, sessionId),
                    eq(haiChatSessions.userId, userId)
                )
            )
            .limit(1);

        if (session.length === 0) {
            return NextResponse.json(
                { error: 'Session nicht gefunden.' },
                { status: 404 }
            );
        }

        // Build update object
        const updates: Partial<{ title: string; isActive: boolean }> = {};
        if (title !== undefined) updates.title = title;
        if (isActive !== undefined) updates.isActive = isActive;

        if (Object.keys(updates).length === 0) {
            return NextResponse.json(
                { error: 'Keine Updates angegeben.' },
                { status: 400 }
            );
        }

        // Update session
        await db
            .update(haiChatSessions)
            .set(updates)
            .where(eq(haiChatSessions.id, sessionId));

        return NextResponse.json({
            success: true,
            message: 'Session aktualisiert.',
        });
    } catch (error) {
        console.error('HAI.ai session update error:', error);
        return NextResponse.json(
            { error: 'Ein interner Fehler ist aufgetreten.' },
            { status: 500 }
        );
    }
}

/**
 * DELETE - Delete session and all messages
 */
export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');
        const sessionId = searchParams.get('sessionId');

        if (!userId) {
            return NextResponse.json(
                { error: 'Nicht authentifiziert.' },
                { status: 401 }
            );
        }

        if (!sessionId) {
            return NextResponse.json(
                { error: 'sessionId erforderlich.' },
                { status: 400 }
            );
        }

        // Verify session belongs to user
        const session = await db
            .select({ id: haiChatSessions.id })
            .from(haiChatSessions)
            .where(
                and(
                    eq(haiChatSessions.id, sessionId),
                    eq(haiChatSessions.userId, userId)
                )
            )
            .limit(1);

        if (session.length === 0) {
            return NextResponse.json(
                { error: 'Session nicht gefunden.' },
                { status: 404 }
            );
        }

        // Delete session (messages will cascade)
        await db
            .delete(haiChatSessions)
            .where(eq(haiChatSessions.id, sessionId));

        return NextResponse.json({
            success: true,
            message: 'Session und Nachrichten gelöscht.',
        });
    } catch (error) {
        console.error('HAI.ai session delete error:', error);
        return NextResponse.json(
            { error: 'Ein interner Fehler ist aufgetreten.' },
            { status: 500 }
        );
    }
}

/**
 * POST - Create new session explicitly
 */
export async function POST(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json(
                { error: 'Nicht authentifiziert.' },
                { status: 401 }
            );
        }

        const body = await req.json();
        const { contextType, contextId, title } = body;

        // Create new session
        const newSession = await db
            .insert(haiChatSessions)
            .values({
                userId,
                contextType: contextType || 'general',
                contextId: contextId || null,
                title: title || null,
                isActive: true,
            })
            .returning({
                id: haiChatSessions.id,
                title: haiChatSessions.title,
                contextType: haiChatSessions.contextType,
                createdAt: haiChatSessions.createdAt,
            });

        return NextResponse.json({
            success: true,
            session: newSession[0],
        });
    } catch (error) {
        console.error('HAI.ai session create error:', error);
        return NextResponse.json(
            { error: 'Ein interner Fehler ist aufgetreten.' },
            { status: 500 }
        );
    }
}
