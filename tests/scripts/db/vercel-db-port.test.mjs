// Port der Datenbankverbindungen in Vercel: nur der Port ändert sich, nichts davon landet in der Ausgabe.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeTarget,
  withPort,
} from '../../../scripts/db/vercel-db-port.mjs';

const URL_5432 =
  'postgresql://postgres.abcdefgh:geheimesPasswort@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require';

test('withPort ändert nur den Port', () => {
  const result = withPort(URL_5432, 6543);
  assert.equal(result.changed, true);
  const before = new URL(URL_5432);
  const after = new URL(result.value);
  assert.equal(after.port, '6543');
  assert.equal(after.username, before.username);
  assert.equal(after.password, before.password);
  assert.equal(after.hostname, before.hostname);
  assert.equal(after.pathname, before.pathname);
  assert.equal(after.search, before.search);
});

test('withPort ist wiederholbar und geht zurück auf 5432', () => {
  const up = withPort(URL_5432, 6543).value;
  assert.deepEqual(withPort(up, 6543), { value: up, changed: false });
  assert.equal(withPort(up, 5432).value, URL_5432);
});

test('withPort kennt eine Adresse ohne Port als 5432', () => {
  const noPort =
    'postgres://postgres.abc:pw@aws-1-eu-west-1.pooler.supabase.com/postgres';
  assert.equal(withPort(noPort, 5432).changed, false);
  assert.equal(new URL(withPort(noPort, 6543).value).port, '6543');
});

test('withPort lehnt fremde Ports und fremde Adressen ab', () => {
  assert.throws(() => withPort(URL_5432, 3306), /nicht erlaubt/);
  assert.throws(() => withPort('https://example.com', 6543), /Postgres/);
  assert.throws(() => withPort('', 6543), /Postgres/);
});

test('describeTarget nennt weder Benutzer noch Passwort', () => {
  const text = describeTarget(URL_5432);
  assert.equal(text, '…pooler.supabase.com:5432');
  assert.ok(!text.includes('geheimesPasswort'));
  assert.ok(!text.includes('postgres.abcdefgh'));
});
