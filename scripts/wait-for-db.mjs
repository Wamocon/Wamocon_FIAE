// Simple DB readiness probe using 'pg'
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const url = process.env.DB_CONNECTION_STRING;
if (!url) {
  console.error('[wait-for-db] DB_CONNECTION_STRING is not set');
  process.exit(1);
}

const timeoutMs = 60_000; // 60s
const start = Date.now();

async function tryConnect() {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    console.log('[wait-for-db] Database is reachable');
    return true;
  } catch (e) {
    return false;
  }
}

(async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ok = await tryConnect();
    if (ok) process.exit(0);
    if (Date.now() - start > timeoutMs) {
      console.error('[wait-for-db] Timed out waiting for DB');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
