/**
 * Fix course ownership - transfer all courses to Trainer 1
 */
import 'dotenv/config';
import db from '../src/db';
import { profiles, courses, courseMembers } from '../src/db/migrations/schemas/schema';
import { eq, sql } from 'drizzle-orm';

async function main() {
    console.log('🔧 Fix Course Ownership Script');
    console.log('===============================\n');

    // Find Trainer 1's profile ID
    const [trainer1] = await db.select().from(profiles).where(eq(profiles.fullName, 'Trainer 1'));

    if (!trainer1) {
        console.error('❌ Trainer 1 not found!');
        process.exit(1);
    }

    console.log(`✅ Found Trainer 1: ${trainer1.id}`);

    // Count courses before update
    const [countBefore] = await db.execute(sql`SELECT COUNT(*) as count FROM courses`);
    console.log(`📊 Total courses to update: ${(countBefore as any).count}`);

    // Update all courses to be created by Trainer 1
    await db.execute(sql`UPDATE courses SET created_by_id = ${trainer1.id}`);
    console.log('✅ Updated all courses to be owned by Trainer 1');

    // Also add Trainer 1 as a course member (TRAINER role) for all courses
    // First, get all course IDs
    const allCourses = await db.select({ id: courses.id }).from(courses);

    console.log(`🔄 Adding Trainer 1 as course member for ${allCourses.length} courses...`);

    for (const course of allCourses) {
        // Check if already a member
        const [existing] = await db.select().from(courseMembers)
            .where(eq(courseMembers.courseId, course.id))
            .where(eq(courseMembers.userId, trainer1.id));

        if (!existing) {
            await db.insert(courseMembers).values({
                courseId: course.id,
                userId: trainer1.id,
                role: 'TRAINER',
            });
        }
    }

    console.log('✅ Added Trainer 1 as course member for all courses');

    console.log('\n🎉 Done! Trainer 1 should now see all courses in the UI.');
    console.log('   Please refresh the page at /trainer/content-management');

    process.exit(0);
}

main().catch(e => {
    console.error('Error:', e);
    process.exit(1);
});
