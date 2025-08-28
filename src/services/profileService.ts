// import db from "@/db";
// import { profiles } from "@/db/migrations/schemas/schema";

// export async function createProfileOnSignup(user: { id: string; full_name: string }) {
//   await db.insert(profiles).values({
//     auth_id: user.id,
//     full_name: user.full_name,
//     role: null, // manually assigned later
//   });
// }

// export async function assignRole(authId: string, role: "trainee" | "trainer") {
//   await db.update(profiles).set({ role }).where({ auth_id: authId });
// }
