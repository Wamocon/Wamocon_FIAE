/**
 * Shared Authorization Helpers for Trainer APIs
 * 
 * Implements the SHARED CURRICULUM MODEL:
 * - Any authenticated TRAINER can manage any course content
 * - Authorization checks verify the user is a valid TRAINER in the system
 * - Individual ownership (createdById) is kept for audit purposes only
 */

import db from '@/db';
import { eq } from 'drizzle-orm';
import { profiles } from '@/db/migrations/schemas/schema';

/**
 * Verify the requesting user is a valid TRAINER in the system.
 * For shared curriculum model, any TRAINER can manage any course.
 * 
 * @param trainerId - The profile ID to verify
 * @returns true if the user exists and has TRAINER role
 */
export async function verifyTrainer(trainerId: string): Promise<boolean> {
    if (!trainerId) return false;

    try {
        const [trainer] = await db
            .select({ role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, trainerId as any));

        return trainer?.role === 'TRAINER';
    } catch (error) {
        console.error('Error verifying trainer:', error);
        return false;
    }
}

/**
 * Verify the requesting user is a valid TRAINEE in the system.
 * 
 * @param traineeId - The profile ID to verify
 * @returns true if the user exists and has TRAINEE role
 */
export async function verifyTrainee(traineeId: string): Promise<boolean> {
    if (!traineeId) return false;

    try {
        const [trainee] = await db
            .select({ role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, traineeId as any));

        return trainee?.role === 'TRAINEE';
    } catch (error) {
        console.error('Error verifying trainee:', error);
        return false;
    }
}

/**
 * Get user profile by ID
 * 
 * @param userId - The profile ID
 * @returns The profile or null if not found
 */
export async function getProfile(userId: string) {
    if (!userId) return null;

    try {
        const [profile] = await db
            .select()
            .from(profiles)
            .where(eq(profiles.id, userId as any));

        return profile || null;
    } catch (error) {
        console.error('Error getting profile:', error);
        return null;
    }
}
