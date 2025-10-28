import 'dotenv/config';
import db from '../src/db';
import { modules } from '../src/db/migrations/schemas/schema';

async function main() {
  const rows = await db.select().from(modules).orderBy(modules.order_index);
  console.log(JSON.stringify(rows.map(r => ({ id: r.id, title: r.title, training_year: r.training_year })), null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
