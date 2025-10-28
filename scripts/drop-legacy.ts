import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const url = process.env.DB_CONNECTION_STRING;
  if (!url) {
    console.error('DB_CONNECTION_STRING not set');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    // Drop legacy tables that conflict with the new schema evolution
    // Use CASCADE to remove dependent FKs cleanly
    const statements = [
      // Old content model
      'DROP TABLE IF EXISTS submission_answers CASCADE',
      'DROP TABLE IF EXISTS quiz_submissions CASCADE',
      'DROP TABLE IF EXISTS options CASCADE',
      'DROP TABLE IF EXISTS questions CASCADE',
      'DROP TABLE IF EXISTS quizzes CASCADE',
      'DROP TABLE IF EXISTS progress CASCADE',
      'DROP TABLE IF EXISTS sub_lessons CASCADE',
      'DROP TABLE IF EXISTS lessons CASCADE',
      'DROP TABLE IF EXISTS modules CASCADE',
      // Old misc tables
      'DROP TABLE IF EXISTS knowledge_submissions CASCADE',
      'DROP TABLE IF EXISTS testimonials CASCADE',
      // Adjustables (we will recreate with new structure)
      'DROP TABLE IF EXISTS acceptance_protocols CASCADE',
      'DROP TABLE IF EXISTS reflections CASCADE',
      // Profiles last (depends on many tables)
      'DROP TABLE IF EXISTS profiles CASCADE',
      // Old enums
      'DROP TYPE IF EXISTS user_role CASCADE',
      'DROP TYPE IF EXISTS question_type CASCADE',
      'DROP TYPE IF EXISTS submission_status CASCADE',
      'DROP TYPE IF EXISTS quiz_type CASCADE',
    ];

    for (const s of statements) {
      try {
        await sql.unsafe(s + ';');
        console.log('OK:', s);
      } catch (e: any) {
        console.warn('WARN:', s, e.message);
      }
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
