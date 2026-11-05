import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { countDistinct, desc, eq, inArray } from 'drizzle-orm';
import {
  enablers,
  enablerSubmissions,
  profiles,
  useCases,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';
import { requireTraineeScopeCondition } from '@/lib/auth/trainee-scope-conditions';
import { requireCatalogScope } from '@/lib/catalog/scope';
import {
  enablerSubmissionsWhere,
  reviewableCourseIds,
  newestFirst,
  submissionsOfUseCasesWhere,
} from '@/lib/trainer/pending-reviews';
import { parsePaging, parseStatusFilter } from '@/lib/trainer/review-paging';

// GET /api/trainer/reviews?type=enabler|usecase&status=pending|all|approved|rejected&limit=&offset=
// One page of the lesson (enabler) and use case submissions, newest first, and
// the total of the same filter (enablerTotal, useCaseTotal), so the page can say
// "50 of 2158" and load more (WMCNL-2999). Without `type` both lists are read.
// `onlyPending=true` is the older form of `status=pending`.

export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const scope = await requireCatalogScope(session, req);
    if (isErrorResponse(scope)) return scope;

    const { searchParams } = new URL(req.url);
    const statusFilter = parseStatusFilter(searchParams);
    const { limit, offset } = parsePaging(searchParams);
    const type = searchParams.get('type'); // 'enabler' | 'usecase' | undefined (all)

    // Only submissions of trainees of the own organization (the super admin:
    // every one) and, with a chosen occupation (x-catalog), of that occupation.
    // The platform-owner flag of an organization does not widen the list.
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

    // The courses a trainer reviews: every course of the caller's catalogs. Who
    // the submissions of those courses belong to is limited by the trainee scope
    // above (own organization, chosen occupation), not by who created the
    // course or is a member of it (decision of the owner, WMCNL-2876).
    const courseIds = await reviewableCourseIds(scope);
    if (!courseIds.length)
      return NextResponse.json({
        enablerSubmissions: [],
        useCaseSubmissions: [],
        enablerTotal: 0,
        useCaseTotal: 0,
      });

    let enablerRows: Array<{
      id: string;
      enablerId: string;
      traineeId: string;
      solutionText: string | null;
      solutions: any;
      trainerFeedback: string | null;
      feedbacks: any;
      status: string | null;
      submittedAt: Date;
      enablerTitle?: string;
      traineeName?: string;
      attemptNumber?: number | null;
    }> = [];
    let useCaseRows: Array<{
      id: string;
      useCaseId: string;
      traineeId: string;
      submissionText: string | null;
      status: string | null;
      submittedAt: Date;
      useCaseTitle?: string;
      traineeName?: string;
      attemptNumber?: number | null;
    }> = [];
    let enablerTotal = 0;
    let useCaseTotal = 0;
    if (!type || type === 'enabler') {
      // Get enabler submissions for trainer's courses
      // The same filter the dashboard counts the pending reviews with
      const esWhere = enablerSubmissionsWhere(
        courseIds,
        traineeScope.condition,
        statusFilter
      );
      const [enablerCount] = await db
        .select({ c: countDistinct(enablerSubmissions.id) })
        .from(enablerSubmissions)
        .innerJoin(enablers, eq(enablers.id, enablerSubmissions.enablerId))
        .where(esWhere);
      enablerTotal = Number(enablerCount?.c) || 0;
      const es = await db
        .select({
          id: enablerSubmissions.id,
          enablerId: enablerSubmissions.enablerId,
          traineeId: enablerSubmissions.traineeId,
          solutionText: enablerSubmissions.solutionText,
          solutions: enablerSubmissions.solutions,
          trainerFeedback: enablerSubmissions.trainerFeedback,
          feedbacks: enablerSubmissions.feedbacks,
          status: enablerSubmissions.status,
          submittedAt: enablerSubmissions.submittedAt,
          attemptNumber: enablerSubmissions.attemptNumber,
        })
        .from(enablerSubmissions)
        .leftJoin(enablers, eq(enablers.id, enablerSubmissions.enablerId))
        .where(esWhere)
        .orderBy(
          desc(enablerSubmissions.submittedAt),
          desc(enablerSubmissions.id)
        )
        .limit(limit)
        .offset(offset);
      enablerRows = es;

      if (enablerRows.length) {
        // Load titles and trainee names
        const enIds = Array.from(
          new Set(enablerRows.map(r => String(r.enablerId)))
        );
        const trIds = Array.from(
          new Set(enablerRows.map(r => String(r.traineeId)))
        );
        const enMapArr = await db
          .select({ id: enablers.id, title: enablers.title })
          .from(enablers)
          .where(inArray(enablers.id, enIds));
        const trMapArr = await db
          .select({ id: profiles.id, fullName: profiles.fullName })
          .from(profiles)
          .where(inArray(profiles.id, trIds));
        const enMap = Object.fromEntries(
          enMapArr.map(e => [String(e.id), e.title])
        );
        const trMap = Object.fromEntries(
          trMapArr.map(p => [String(p.id), p.fullName])
        );
        enablerRows = enablerRows.map(r => ({
          ...r,
          enablerTitle: enMap[String(r.enablerId)] || 'Enabler',
          traineeName: trMap[String(r.traineeId)] || 'Unbekannt',
          attemptNumber: (r as any).attemptNumber,
        }));
      }
    }

    if (!type || type === 'usecase') {
      const usWhere = submissionsOfUseCasesWhere(
        courseIds,
        traineeScope.condition,
        statusFilter
      );
      const [useCaseCount] = await db
        .select({ c: countDistinct(useCaseSubmissions.id) })
        .from(useCaseSubmissions)
        .innerJoin(useCases, eq(useCases.id, useCaseSubmissions.useCaseId))
        .where(usWhere);
      useCaseTotal = Number(useCaseCount?.c) || 0;
      const us = await db
        .select({
          id: useCaseSubmissions.id,
          useCaseId: useCaseSubmissions.useCaseId,
          traineeId: useCaseSubmissions.traineeId,
          submissionText: useCaseSubmissions.submissionText,
          status: useCaseSubmissions.status,
          submittedAt: useCaseSubmissions.submittedAt,
          attemptNumber: useCaseSubmissions.attemptNumber,
        })
        .from(useCaseSubmissions)
        .leftJoin(useCases, eq(useCases.id, useCaseSubmissions.useCaseId))
        .where(usWhere)
        .orderBy(
          desc(useCaseSubmissions.submittedAt),
          desc(useCaseSubmissions.id)
        )
        .limit(limit)
        .offset(offset);
      useCaseRows = us;

      if (useCaseRows.length) {
        const ucIds = Array.from(
          new Set(useCaseRows.map(r => String(r.useCaseId)))
        );
        const trIds = Array.from(
          new Set(useCaseRows.map(r => String(r.traineeId)))
        );
        const ucMapArr = await db
          .select({ id: useCases.id, title: useCases.title })
          .from(useCases)
          .where(inArray(useCases.id, ucIds));
        const trMapArr = await db
          .select({ id: profiles.id, fullName: profiles.fullName })
          .from(profiles)
          .where(inArray(profiles.id, trIds));
        const ucMap = Object.fromEntries(
          ucMapArr.map(e => [String(e.id), e.title])
        );
        const trMap = Object.fromEntries(
          trMapArr.map(p => [String(p.id), p.fullName])
        );
        useCaseRows = useCaseRows.map(r => ({
          ...r,
          useCaseTitle: ucMap[String(r.useCaseId)] || 'Use Case',
          traineeName: trMap[String(r.traineeId)] || 'Unbekannt',
          attemptNumber: (r as any).attemptNumber,
        }));
      }
    }

    return NextResponse.json({
      enablerSubmissions: newestFirst(enablerRows),
      useCaseSubmissions: newestFirst(useCaseRows),
      enablerTotal,
      useCaseTotal,
    });
  } catch (e) {
    console.error('Trainer reviews GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
