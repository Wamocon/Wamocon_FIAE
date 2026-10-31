/**
 * School Exams API - CRUD operations for exam tracking
 *
 * GET  /api/trainee/school/exams - List exams for trainee
 * POST /api/trainee/school/exams - Create single exam
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import {
  schoolExams,
  schoolExamResults,
  profiles,
  ausbildungBlocks,
} from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { getTrainingPhase } from '@/lib/ausbildung/duration';
import { loadPhasePlanForUser } from '@/lib/catalog/phase-plan-db';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { daysFromToday, startOfToday } from '@/lib/school/day';
import { refreshTraineeDashboard } from '@/lib/school/dashboard-cache';

// Helper to get current Schuljahr
function getCurrentSchuljahr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

// Helper to calculate the module phase for an exam date.
function calculateAusbildungsjahr(
  startDate: Date,
  durationYears?: number | null,
  atDate: Date = new Date(),
  phaseOneMonths?: number | null
): number {
  return getTrainingPhase(startDate, durationYears, atDate, phaseOneMonths);
}

// GET /api/trainee/school/exams?upcoming=true&schuljahr=...
// upcoming=true: from the start of today on, upcoming=false: before today (the
// past), without the parameter: every exam (calendar, results).
// The exams of the session user. A traineeId in the query (sent by older
// clients) is ignored, the session is the only identity.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const { searchParams } = new URL(req.url);
    const schuljahr = searchParams.get('schuljahr');
    const upcomingParam = searchParams.get('upcoming');
    const upcoming = upcomingParam === 'true';
    const past = upcomingParam === 'false';
    // The split is the start of today (calendar day of Germany), not the
    // current instant: an exam of today is a date without a time and still
    // lies ahead
    const todayStart = startOfToday();
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Build query conditions
    const conditions = [eq(schoolExams.traineeId, traineeId as any)];

    if (schuljahr) {
      conditions.push(eq(schoolExams.schuljahr, schuljahr));
    }

    if (upcoming) conditions.push(gte(schoolExams.examDate, todayStart));
    if (past) conditions.push(lt(schoolExams.examDate, todayStart));

    // Get exams with optional result join
    const rows = await db
      .select({
        exam: schoolExams,
        result: schoolExamResults,
      })
      .from(schoolExams)
      .leftJoin(schoolExamResults, eq(schoolExams.id, schoolExamResults.examId))
      .where(and(...conditions))
      .orderBy(
        upcoming ? asc(schoolExams.examDate) : desc(schoolExams.examDate)
      )
      .limit(limit);

    // Also fetch EXAM-type blocks from ausbildungBlocks (calendar)
    const blockConditions = [
      eq(ausbildungBlocks.traineeId, traineeId as any),
      eq(ausbildungBlocks.blockType, 'EXAM'),
    ];
    if (upcoming) {
      blockConditions.push(gte(ausbildungBlocks.startDate, todayStart));
    }
    if (past) blockConditions.push(lt(ausbildungBlocks.startDate, todayStart));

    const examBlocks = await db
      .select()
      .from(ausbildungBlocks)
      .where(and(...blockConditions))
      .orderBy(
        upcoming
          ? asc(ausbildungBlocks.startDate)
          : desc(ausbildungBlocks.startDate)
      )
      .limit(limit);

    // Collect school_exams dates to avoid duplicate entries
    const schoolExamDates = new Set(
      rows.map(
        ({ exam }) => new Date(exam.examDate).toISOString().split('T')[0]
      )
    );

    // Convert EXAM blocks to the same shape, skip if a school_exam already covers that date
    const examSubTypeLabels: Record<string, string> = {
      IHK_ABSCHLUSSPRUEFUNG_T1: 'IHK Abschlussprüfung Teil 1',
      IHK_ABSCHLUSSPRUEFUNG_T2: 'IHK Abschlussprüfung Teil 2',
      KLAUSUR_WMC: 'Klausur WMC',
      KLAUSUR_ALLGEMEIN: 'Klausur',
      PRAKTISCHE_PRUEFUNG: 'Praktische Prüfung',
      MUENDLICHE_PRUEFUNG: 'Mündliche Prüfung',
      PROJEKTARBEIT: 'Projektarbeit',
      ANDERE: 'Prüfung',
    };

    const blockExams = examBlocks
      .filter(block => {
        const blockDate = new Date(block.startDate).toISOString().split('T')[0];
        return !schoolExamDates.has(blockDate);
      })
      .map(block => ({
        id: block.id,
        traineeId: block.traineeId,
        schuljahr: block.schuljahr,
        ausbildungsjahr: block.ausbildungsjahr,
        examDate: block.startDate,
        dayOfWeek: null,
        period: null,
        teacher: null,
        subject:
          block.title ||
          (block.examSubType
            ? examSubTypeLabels[block.examSubType] || 'Prüfung'
            : 'Prüfung'),
        examTypeValue: null,
        lernfeldCode: null,
        notes: block.notes || block.description || null,
        isPersonal: block.isPersonal ?? false,
        importedFrom: block.importedFrom,
        createdAt: block.createdAt,
        updatedAt: block.updatedAt,
        _source: 'calendar' as const,
      }));

    // Format response with countdown for upcoming exams
    const now = new Date();
    const allExams = [
      ...rows.map(({ exam, result }) => ({
        ...exam,
        result: result || null,
        _source: 'exams' as const,
      })),
      ...blockExams.map(e => ({ ...e, result: null })),
    ];

    // Sort combined list
    allExams.sort((a, b) => {
      const dateA = new Date(a.examDate).getTime();
      const dateB = new Date(b.examDate).getTime();
      return upcoming ? dateA - dateB : dateB - dateA;
    });

    const examsWithMeta = allExams.map(exam => ({
      ...exam,
      meta: daysFromToday(new Date(exam.examDate), now),
    }));

    return NextResponse.json({
      exams: examsWithMeta,
      meta: {
        currentSchuljahr: getCurrentSchuljahr(),
        total: examsWithMeta.length,
      },
    });
  } catch (e) {
    console.error('List exams error:', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// POST /api/trainee/school/exams
// The exam belongs to the session user, a traineeId in the body is ignored.
export async function POST(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const body = await req.json();
    const {
      schuljahr,
      ausbildungsjahr,
      examDate,
      dayOfWeek,
      period,
      teacher,
      subject,
      examType,
      lernfeldCode,
      notes,
      isPersonal = false,
    } = body;

    // Validation
    if (!examDate)
      return NextResponse.json({ error: 'examDate required' }, { status: 400 });
    if (!subject)
      return NextResponse.json({ error: 'subject required' }, { status: 400 });

    const organizationId = await getUserOrgId(traineeId);

    // Get trainee profile for defaults
    const [trainee] = await db
      .select({
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId));

    // Phase one of the trainee's occupation (KfBM 15 months, FIAE 18)
    const phasePlan =
      trainee?.startOfTrainingDate
        ? await loadPhasePlanForUser(traineeId, trainee.ausbildungDurationYears)
        : null;
    const calculatedAusbildungsjahr =
      trainee?.startOfTrainingDate
        ? calculateAusbildungsjahr(
            trainee.startOfTrainingDate,
            trainee.ausbildungDurationYears,
            new Date(examDate),
            phasePlan?.phaseMonths[0]
          )
        : ausbildungsjahr || 1;
    const calculatedSchuljahr = schuljahr || getCurrentSchuljahr();

    // Validate exam type if provided
    const validExamTypes = [
      'KLAUSUR',
      'TEST',
      'ABGABE',
      'PRAESENTATION',
      'MUENDLICH',
    ];
    if (examType && !validExamTypes.includes(examType)) {
      return NextResponse.json(
        {
          error: `Invalid examType. Must be one of: ${validExamTypes.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Infer Lernfeld code from subject if not provided
    let inferredLernfeldCode = lernfeldCode;
    if (!inferredLernfeldCode && subject) {
      const lfMatch = subject.match(/^LF(\d+[a-z]?)$/i);
      if (lfMatch) {
        inferredLernfeldCode = `LF${lfMatch[1].toUpperCase()}`;
      }
    }

    const [row] = await db
      .insert(schoolExams)
      .values({
        traineeId: traineeId as any,
        organizationId,
        schuljahr: calculatedSchuljahr,
        ausbildungsjahr: calculatedAusbildungsjahr,
        examDate: new Date(examDate),
        dayOfWeek: dayOfWeek || null,
        period: period || null,
        teacher: teacher || null,
        subject,
        examTypeValue: examType || null,
        lernfeldCode: inferredLernfeldCode || null,
        notes: notes || null,
        isPersonal,
      })
      .returning();

    refreshTraineeDashboard();
    return NextResponse.json({ id: row.id, exam: row }, { status: 201 });
  } catch (e) {
    console.error('Create exam error:', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
