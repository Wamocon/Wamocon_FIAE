/**
 * School Exams API - CRUD operations for exam tracking
 * 
 * GET  /api/trainee/school/exams - List exams for trainee
 * POST /api/trainee/school/exams - Create single exam
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { schoolExams, schoolExamResults, profiles, ausbildungBlocks } from '@/db/migrations/schemas/schema';

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

        // Also fetch EXAM-type blocks from ausbildungBlocks (calendar)
        const blockConditions = [
            eq(ausbildungBlocks.traineeId, traineeId as any),
            eq(ausbildungBlocks.blockType, 'EXAM'),
        ];
        if (upcoming) {
            const now2 = new Date();
            blockConditions.push(gte(ausbildungBlocks.startDate, now2));
        }

        const examBlocks = await db
            .select()
            .from(ausbildungBlocks)
            .where(and(...blockConditions))
            .orderBy(upcoming ? asc(ausbildungBlocks.startDate) : desc(ausbildungBlocks.startDate))
            .limit(limit);

        // Collect school_exams dates to avoid duplicate entries
        const schoolExamDates = new Set(
            rows.map(({ exam }) => new Date(exam.examDate).toISOString().split('T')[0])
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
                subject: block.title || (block.examSubType ? examSubTypeLabels[block.examSubType] || 'Prüfung' : 'Prüfung'),
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

        const examsWithMeta = allExams.map((exam) => {
            const examDate = new Date(exam.examDate);
            const daysUntil = Math.ceil((examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

            return {
                ...exam,
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
                total: examsWithMeta.length,
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
