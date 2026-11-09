// Stellt den Port der Datenbankverbindungen der App in Vercel (Ziel Production) um.
//
// Warum: Beide Verbindungen (DB_CONNECTION_STRING und HAI_DB_CONNECTION_STRING) zeigen auf den
// Session-Modus des Supabase-Poolers (Port 5432, Grenze 15 Sitzungen). Jede Instanz der App darf bis zu 10 plus
// 10 Sitzungen öffnen, der Pool ist deshalb oft voll (EMAXCONNSESSION). Der Transaktionsmodus (Port 6543)
// verteilt viele Clients auf dieselben Datenbankverbindungen. Der Code ist dafür vorbereitet (prepare: false,
// keine Sitzungsfunktionen wie set_config, Advisory-Locks oder LISTEN).
//
// Aufruf im Repo-Ordner:
//   node scripts/db/vercel-db-port.mjs                       Trockenlauf, schreibt nichts
//   node scripts/db/vercel-db-port.mjs --apply               Port 6543 setzen
//   node scripts/db/vercel-db-port.mjs --port 5432 --apply   Rückweg auf den Session-Modus
//
// Liest VERCEL_API_TOKEN aus der Umgebung oder aus .env.local. Gelesen und geschrieben wird nur der Wert
// derselben Variable, es ändert sich ausschließlich der Port. Passwörter werden nie ausgegeben. Eine
// Änderung gilt erst mit dem nächsten Deployment ("Production Deploy").
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROJECT = 'prj_nbHzAS4oCNAgHaJh1gb8rfSAndHA';
const TEAM = 'team_3KLIxWWTDEzyuitA2oGwAorz';
const KEYS = ['DB_CONNECTION_STRING', 'HAI_DB_CONNECTION_STRING'];
const PORTS = ['5432', '6543'];

/** Host und Port ohne Benutzer und Passwort, für die Ausgabe. */
export function describeTarget(connectionString) {
  const u = new URL(connectionString);
  return `${u.hostname.replace(/^[^.]*\./, '…')}:${u.port || '5432'}`;
}

/**
 * Dieselbe Adresse mit anderem Port. Benutzer, Passwort, Host und Parameter bleiben unverändert.
 * Gibt `changed: false` zurück, wenn der Port schon stimmt.
 */
export function withPort(connectionString, port) {
  if (!PORTS.includes(String(port))) {
    throw new Error(`Port ${port} nicht erlaubt (${PORTS.join(' oder ')})`);
  }
  if (!/^postgres(ql)?:\/\//.test(connectionString || '')) {
    throw new Error('Keine Postgres-Adresse');
  }
  const u = new URL(connectionString);
  const from = u.port || '5432';
  if (from === String(port)) return { value: connectionString, changed: false };
  u.port = String(port);
  return { value: u.toString(), changed: true };
}

function readToken() {
  if (process.env.VERCEL_API_TOKEN) return process.env.VERCEL_API_TOKEN;
  if (!existsSync('.env.local')) return null;
  const line = readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .find(l => l.startsWith('VERCEL_API_TOKEN='));
  return line
    ? line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^"|"$/g, '')
    : null;
}

async function main(argv) {
  const apply = argv.includes('--apply');
  const portIndex = argv.indexOf('--port');
  const port = portIndex >= 0 ? argv[portIndex + 1] : '6543';
  const token = readToken();
  if (!token) {
    throw new Error('VERCEL_API_TOKEN fehlt (Umgebung oder .env.local)');
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const base = 'https://api.vercel.com';
  const list = await (
    await fetch(`${base}/v9/projects/${PROJECT}/env?teamId=${TEAM}`, {
      headers,
    })
  ).json();
  let changedAny = false;
  for (const key of KEYS) {
    const entries = (list.envs || []).filter(
      e =>
        e.key === key && (e.target || []).includes('production') && !e.gitBranch
    );
    if (!entries.length) {
      console.log(`${key}: keine Variable für Production gefunden`);
    }
    for (const e of entries) {
      const one = await (
        await fetch(
          `${base}/v1/projects/${PROJECT}/env/${e.id}?teamId=${TEAM}`,
          {
            headers,
          }
        )
      ).json();
      if (!/^postgres/.test(one.value || '')) {
        console.log(`${key}: Wert nicht lesbar (Typ ${e.type}), übersprungen`);
        continue;
      }
      const before = describeTarget(one.value);
      const next = withPort(one.value, port);
      if (!next.changed) {
        console.log(`${key}: steht schon auf Port ${port} (${before})`);
        continue;
      }
      console.log(
        `${apply ? 'Setze' : 'Würde setzen'} ${key} (Ziele ${e.target.join(',')}): ${before} -> Port ${port}`
      );
      if (!apply) continue;
      const res = await fetch(
        `${base}/v9/projects/${PROJECT}/env/${e.id}?teamId=${TEAM}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ value: next.value }),
        }
      );
      console.log(`  Antwort ${res.status}`);
      if (!res.ok) process.exitCode = 1;
      changedAny = true;
    }
  }
  if (apply && changedAny) {
    console.log(
      'Gilt erst mit dem nächsten Deployment: Workflow "Production Deploy" starten.'
    );
  }
  if (!apply)
    console.log('Trockenlauf, nichts geändert. Mit --apply schreiben.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
