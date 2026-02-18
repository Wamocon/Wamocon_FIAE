/**
 * HAI.ai Sync API Route
 *
 * Endpoint for syncing/reindexing vector database content.
 * Supports full content indexing and trainee personal data syncing.
 *
 * POST /api/hai/sync - Trigger sync operations
 *   Actions:
 *     - sync_all: Re-index all content (enablers, courses) + all trainee data
 *     - sync_content: Re-index only shared content (enablers, courses)
 *     - sync_trainees: Re-index only trainee personal data (profiles, schedules, progress)
 *     - sync_trainee: Re-index a single trainee's data (requires traineeId)
 *
 * GET /api/hai/sync - Get sync status
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import haiDb from '@/db/haiDb';
import { eq, sql } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';
import {
  indexAllContent,
  indexAllTrainees,
  indexTraineeData,
} from '@/lib/hai/traineeDataIndexer';

// ============================================================================
// POST — Trigger sync operations
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Auth check — require trainer role
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 401 });
    }

    // Verify the user is a trainer
    const user = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (user.length === 0 || user[0].role !== 'TRAINER') {
      return NextResponse.json(
        { error: 'Unauthorized — trainer access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, traineeId } = body;

    switch (action) {
      case 'sync_all': {
        console.log('HAI.ai Sync: Starting full sync (content + trainees)...');

        // Run content indexing first, then trainees
        const contentResult = await indexAllContent();
        const traineeResult = await indexAllTrainees();

        return NextResponse.json({
          success: true,
          action: 'sync_all',
          content: {
            enablersIndexed: contentResult.enablersIndexed,
            coursesIndexed: contentResult.coursesIndexed,
            errors: contentResult.errors,
          },
          trainees: {
            totalTrainees: traineeResult.totalTrainees,
            successfullyIndexed: traineeResult.successfullyIndexed,
            failed: traineeResult.failed,
            details: traineeResult.results.map(r => ({
              traineeId: r.traineeId,
              name: r.traineeName,
              profileChunks: r.profileResult.chunks,
              scheduleChunks: r.scheduleResult.chunks,
              progressChunks: r.progressResult.chunks,
              errors: r.errors,
            })),
          },
        });
      }

      case 'sync_content': {
        console.log(
          'HAI.ai Sync: Syncing shared content (enablers + courses)...'
        );
        const contentResult = await indexAllContent();

        return NextResponse.json({
          success: true,
          action: 'sync_content',
          enablersIndexed: contentResult.enablersIndexed,
          coursesIndexed: contentResult.coursesIndexed,
          errors: contentResult.errors,
        });
      }

      case 'sync_trainees': {
        console.log('HAI.ai Sync: Syncing all trainee personal data...');
        const traineeResult = await indexAllTrainees();

        return NextResponse.json({
          success: true,
          action: 'sync_trainees',
          totalTrainees: traineeResult.totalTrainees,
          successfullyIndexed: traineeResult.successfullyIndexed,
          failed: traineeResult.failed,
          details: traineeResult.results.map(r => ({
            traineeId: r.traineeId,
            name: r.traineeName,
            profileChunks: r.profileResult.chunks,
            scheduleChunks: r.scheduleResult.chunks,
            progressChunks: r.progressResult.chunks,
            errors: r.errors,
          })),
        });
      }

      case 'sync_trainee': {
        if (!traineeId) {
          return NextResponse.json(
            { error: 'Missing traineeId' },
            { status: 400 }
          );
        }

        console.log(`HAI.ai Sync: Syncing trainee ${traineeId}...`);
        const traineeResult = await indexTraineeData(traineeId);

        return NextResponse.json({
          success: traineeResult.errors.length === 0,
          action: 'sync_trainee',
          traineeId: traineeResult.traineeId,
          name: traineeResult.traineeName,
          profileChunks: traineeResult.profileResult.chunks,
          scheduleChunks: traineeResult.scheduleResult.chunks,
          progressChunks: traineeResult.progressResult.chunks,
          errors: traineeResult.errors,
        });
      }

      default:
        return NextResponse.json(
          {
            error: `Unknown action: ${action}. Expected: sync_all, sync_content, sync_trainees, sync_trainee`,
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('HAI.ai Sync: Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET — Sync status
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 401 });
    }

    // Get embedding counts by source type
    const stats = await haiDb.execute(
      sql`
                SELECT
                    source_type,
                    COUNT(DISTINCT source_id) as source_count,
                    COUNT(*) as chunk_count,
                    MAX(updated_at) as last_updated
                FROM hai_embeddings
                GROUP BY source_type
                ORDER BY source_type
            `
    );

    const totalResult = await haiDb.execute(
      sql`
                SELECT COUNT(*) as total, COUNT(DISTINCT source_id) as sources
                FROM hai_embeddings
            `
    );
    const total = (totalResult as any[])[0] || { total: 0, sources: 0 };

    return NextResponse.json({
      totalEmbeddings: Number(total.total),
      totalSources: Number(total.sources),
      bySourceType: (stats as any[]).map(row => ({
        sourceType: row.source_type,
        sourceCount: Number(row.source_count),
        chunkCount: Number(row.chunk_count),
        lastUpdated: row.last_updated,
      })),
    });
  } catch (error) {
    console.error('HAI.ai Sync: Error fetching status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
