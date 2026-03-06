import 'dotenv/config';
// @ts-ignore
import pg from 'pg';

async function main() {
  const client = new pg.Client(process.env.DB_CONNECTION_STRING);
  await client.connect();

  const res = await client.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'activity_reports' AND column_name = 'skill_self_ratings'`
  );

  if (res.rows.length > 0) {
    console.log('Column skill_self_ratings already exists');
  } else {
    await client.query(
      'ALTER TABLE activity_reports ADD COLUMN skill_self_ratings jsonb'
    );
    console.log('Added skill_self_ratings column to activity_reports');
  }

  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
