import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, desc, and } from 'drizzle-orm';
import { schoolExams, profiles, notifications } from '@/db/migrations/schemas/schema';
import { getUserOrgId, verifyPlatformOwner, verifyTrainer } from '@/lib/auth-helpers';
import { getTrainingPhase } from '@/lib/ausbildung/duration';

// GET /api/trainer/school/exams?trainerId=...&traineeId=...
export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const trainerId = url.searchParams.get('trainerId');
        const traineeId = url.searchParams.get('traineeId');

        if (!trainerId) {
            return NextResponse.json({ error: 'trainerId required' }, { status: 400 });
        }

        if (!(await verifyTrainer(trainerId))) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const isPO = await verifyPlatformOwner(trainerId);
        const trainerOrgId = await getUserOrgId(trainerId);

        const conditions: any[] = [];
        if (traineeId) conditions.push(eq(schoolExams.traineeId, traineeId as any));
        if (!isPO && trainerOrgId) {
            conditions.push(eq(schoolExams.organizationId, trainerOrgId));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const examsRaw = await db
            .select({
                id: schoolExams.id,
                traineeId: schoolExams.traineeId,
                examDate: schoolExams.examDate,
                subject: schoolExams.subject,
                examTypeValue: schoolExams.examTypeValue,
                isPersonal: schoolExams.isPersonal,
                lernfeldCode: schoolExams.lernfeldCode,
                traineeName: profiles.fullName,
            })
            .from(schoolExams)
            .leftJoin(profiles, eq(profiles.id, schoolExams.traineeId))
            .where(whereClause)
            .orderBy(desc(schoolExams.examDate));

        // Transform to include isCompanyExam flag (exams with no lernfeld are company exams)
        const exams = examsRaw.map(exam => ({
            ...exam,
            isCompanyExam: !exam.lernfeldCode,
            points: null, // Will be populated from results if needed
            maxPoints: null,
            passed: null,
        }));

        return NextResponse.json({ exams });
    } catch (e) {
        console.error('Get trainer exams error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST /api/trainer/school/exams - Create company exam
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { trainerId, traineeId, subject, examDate, examTypeValue } = body;

        if (!trainerId || !traineeId || !subject || !examDate) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (!(await verifyTrainer(trainerId))) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const organizationId = await getUserOrgId(trainerId);

        const isPO = await verifyPlatformOwner(trainerId);
        if (!isPO) {
            const traineeOrgId = await getUserOrgId(traineeId);
            if (organizationId !== traineeOrgId) {
                return NextResponse.json({ error: 'Trainee not in your organization' }, { status: 403 });
            }
        }

        const [trainee] = await db
            .select({
                fullName: profiles.fullName,
                startOfTrainingDate: profiles.startOfTrainingDate,
                ausbildungDurationYears: profiles.ausbildungDurationYears
            })
            .from(profiles)
            .where(eq(profiles.id, traineeId));

        const now = new Date();
        const startDate = trainee?.startOfTrainingDate || now;
        const ausbildungsjahr = getTrainingPhase(
            startDate,
            trainee?.ausbildungDurationYears,
            new Date(examDate)
        );
        const schuljahr = `${now.getFullYear()}/${now.getFullYear() + 1}`;

        const [exam] = await db
            .insert(schoolExams)
            .values({
                traineeId: traineeId as any,
                examDate: new Date(examDate),
                subject,
                examTypeValue: examTypeValue || 'KLAUSUR',
                isPersonal: false,
                schuljahr,
                ausbildungsjahr,
                organizationId,
            })
            .returning();

        // Notify the trainee about the scheduled exam
        try {
            const examDateStr = new Date(examDate).toLocaleDateString('de-DE');
            await db.insert(notifications).values({
                userId: traineeId,
                actorId: trainerId,
                type: 'EXAM_SCHEDULED',
                title: 'Neue Prüfung geplant',
                message: `Eine Prüfung "${subject}" wurde für den ${examDateStr} geplant.`,
                linkUrl: '/trainee/school?tab=exams',
                context: { examId: exam.id, subject, examDate },
                organizationId,
            });
        } catch (notifyErr) {
            console.warn('Failed to notify trainee for exam scheduling', notifyErr);
        }

        return NextResponse.json({
            exam: {
                ...exam,
                traineeName: trainee?.fullName || 'Unknown',
                isCompanyExam: true,
            },
        });
    } catch (e) {
        console.error('Create company exam error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
