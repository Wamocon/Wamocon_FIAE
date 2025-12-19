/**
 * Debug script to check profiles and course ownership
 */
import 'dotenv/config';
import db from '../src/db';
import { profiles, courses } from '../src/db/migrations/schemas/schema';

async function main() {
    // Get all profiles
    const allProfiles = await db.select().from(profiles);
    console.log('\n📋 All Profiles in Database:');
    console.log('='.repeat(60));
    allProfiles.forEach(p => {
        console.log(`  ${p.role?.padEnd(10)} | ${p.fullName?.padEnd(30)} | ${p.id.slice(0, 8)}...`);
    });

    // Get courses and their creators
    const allCourses = await db.select({
        id: courses.id,
        title: courses.title,
        createdById: courses.createdById,
    }).from(courses).limit(5);

    console.log('\n📚 Sample Courses (first 5):');
    console.log('='.repeat(60));
    allCourses.forEach(c => {
        console.log(`  ${c.title.slice(0, 50).padEnd(52)} | createdBy: ${c.createdById?.slice(0, 8)}...`);
    });

    // Check if any courses exist and who created them
    const creatorIds = [...new Set(allCourses.map(c => c.createdById).filter(Boolean))];
    console.log('\n🔑 Unique Creator IDs:', creatorIds.map(id => id?.slice(0, 8) + '...'));

    // Match creators to profiles
    const trainers = allProfiles.filter(p => p.role === 'TRAINER');
    console.log('\n👤 Available Trainers:');
    trainers.forEach(t => {
        const isCourseCreator = creatorIds.includes(t.id);
        console.log(`  ${t.fullName}: ${t.id.slice(0, 8)}... ${isCourseCreator ? '✅ (Course Creator)' : ''}`);
    });

    process.exit(0);
}

main().catch(e => {
    console.error('Error:', e);
    process.exit(1);
});
