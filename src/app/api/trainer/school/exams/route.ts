import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, desc, and } from 'drizzle-orm';
import { schoolExams, profiles, notifications } from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import {
    requireTraineeScopeCondition,
    traineeIdInScope,
} from '@/lib/auth/trainee-scope-conditions';
import { getTrainingPhase } from '@/lib/ausbildung/duration';
import { loadPhasePlanForUser } from '@/lib/catalog/phase-plan-db';

// GET /api/trainer/school/exams?trainerId=...&traineeId=...
export async function GET(req: NextRequest) {
    try {
        const session = await requireTrainer(req);
        if (isErrorResponse(session)) return session;

        const url = new URL(req.url);
        const traineeId = url.searchParams.get('traineeId');

        // One trainee of the own organization and chosen occupation, or all
        // trainees inside that scope (the super admin sees every organization)
        const conditions: any[] = [];
        if (traineeId) {
            const access = await requireTraineeAccess(session, traineeId, req);
            if (isErrorResponse(access)) return access;
            conditions.push(eq(schoolExams.traineeId, access.traineeId as any));
        } else {
            const traineeScope = await requireTraineeScopeCondition(session, req);
            if (isErrorResponse(traineeScope)) return traineeScope;
            conditions.push(traineeIdInScope(schoolExams.traineeId, traineeScope.condition));
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
        const session = await requireTrainer(req);
        if (isErrorResponse(session)) return session;

        const body = await req.json();
        const { traineeId, subject, examDate, examTypeValue } = body;
        const trainerId = session.id;

        if (!traineeId || !subject || !examDate) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const access = await requireTraineeAccess(session, String(traineeId), req);
        if (isErrorResponse(access)) return access;

        const trainerOrganizationId = await getUserOrgId(trainerId);

        const [trainee] = await db
            .select({
                fullName: profiles.fullName,
                organizationId: profiles.organizationId,
                startOfTrainingDate: profiles.startOfTrainingDate,
                ausbildungDurationYears: profiles.ausbildungDurationYears
            })
            .from(profiles)
            .where(eq(profiles.id, traineeId));

        // The exam belongs to the organization of the trainee (for everybody
        // but the super admin that is the organization of the trainer)
        const organizationId = trainee?.organizationId ?? trainerOrganizationId;

        const now = new Date();
        const startDate = trainee?.startOfTrainingDate || now;
        // Phase one of the trainee's occupation (KfBM 15 months, FIAE 18)
        const phasePlan = await loadPhasePlanForUser(
            String(traineeId),
            trainee?.ausbildungDurationYears
        );
        const ausbildungsjahr = getTrainingPhase(
            startDate,
            trainee?.ausbildungDurationYears,
            new Date(examDate),
            phasePlan.phaseMonths[0]
        );
        const schuljahr = `${now.getFullYear()}/${now.getFullYear() + 1}`;

        const [exam] = await db
            .insert(schoolExams)
            .values({
                traineeId: access.traineeId as any,
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
