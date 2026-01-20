/**
 * School Exams API - CRUD operations for exam tracking
 * 
 * GET  /api/trainee/school/exams - List exams for trainee
 * POST /api/trainee/school/exams - Create single exam
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { schoolExams, schoolExamResults, profiles } from '@/db/migrations/schemas/schema';

// Helper to get current Schuljahr
function getCurrentSchuljahr(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

// Helper to calculate Ausbildungsjahr
function calculateAusbildungsjahr(startDate: Date): number {
    const now = new Date();
    const monthsSince = (now.getFullYear() - startDate.getFullYear()) * 12 +
        (now.getMonth() - startDate.getMonth());
    if (monthsSince < 12) return 1;
    if (monthsSince < 24) return 2;
    return 3;
}

// GET /api/trainee/school/exams?traineeId=...&upcoming=true&schuljahr=...
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const traineeId = searchParams.get('traineeId');
        const schuljahr = searchParams.get('schuljahr');
        const upcoming = searchParams.get('upcoming') === 'true';
        const limit = parseInt(searchParams.get('limit') || '50', 10);

        if (!traineeId) {
            return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
        }

        // Build query conditions
        const conditions = [eq(schoolExams.traineeId, traineeId as any)];

        if (schuljahr) {
            conditions.push(eq(schoolExams.schuljahr, schuljahr));
        }

        if (upcoming) {
            const now = new Date();
            conditions.push(gte(schoolExams.examDate, now));
        }

        // Get exams with optional result join
        const rows = await db
            .select({
                exam: schoolExams,
                result: schoolExamResults,
            })
            .from(schoolExams)
            .leftJoin(
                schoolExamResults,
                eq(schoolExams.id, schoolExamResults.examId)
            )
            .where(and(...conditions))
            .orderBy(upcoming ? asc(schoolExams.examDate) : desc(schoolExams.examDate))
            .limit(limit);

        // Format response with countdown for upcoming exams
        const now = new Date();
        const examsWithMeta = rows.map(({ exam, result }) => {
            const examDate = new Date(exam.examDate);
            const daysUntil = Math.ceil((examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

            return {
                ...exam,
                result: result || null,
                meta: {
                    daysUntil,
                    isPast: daysUntil < 0,
                    isToday: daysUntil === 0,
                    isSoon: daysUntil >= 0 && daysUntil <= 7,
                },
            };
        });

        return NextResponse.json({
            exams: examsWithMeta,
            meta: {
                currentSchuljahr: getCurrentSchuljahr(),
                total: rows.length,
            }
        });
    } catch (e) {
        console.error('List exams error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST /api/trainee/school/exams
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            traineeId,
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
            isPersonal = false
        } = body;

        // Validation
        if (!traineeId) return NextResponse.json({ error: 'traineeId required' }, { status: 400 });
        if (!examDate) return NextResponse.json({ error: 'examDate required' }, { status: 400 });
        if (!subject) return NextResponse.json({ error: 'subject required' }, { status: 400 });

        // Get trainee profile for defaults
        const [trainee] = await db
            .select({ startOfTrainingDate: profiles.startOfTrainingDate })
            .from(profiles)
            .where(eq(profiles.id, traineeId));

        const calculatedAusbildungsjahr = ausbildungsjahr ||
            (trainee?.startOfTrainingDate ? calculateAusbildungsjahr(trainee.startOfTrainingDate) : 1);
        const calculatedSchuljahr = schuljahr || getCurrentSchuljahr();

        // Validate exam type if provided
        const validExamTypes = ['KLAUSUR', 'TEST', 'ABGABE', 'PRAESENTATION', 'MUENDLICH'];
        if (examType && !validExamTypes.includes(examType)) {
            return NextResponse.json({
                error: `Invalid examType. Must be one of: ${validExamTypes.join(', ')}`
            }, { status: 400 });
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

        return NextResponse.json({ id: row.id, exam: row }, { status: 201 });
    } catch (e) {
        console.error('Create exam error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
