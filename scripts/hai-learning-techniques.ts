/**
 * Learning technique cards for the HAI index (package B).
 *
 *   npx tsx scripts/hai-learning-techniques.ts            dry run (default)
 *   npx tsx scripts/hai-learning-techniques.ts --apply    write to the index
 *
 * The dry run reads the card files, validates them and prints what would be
 * written. It uses neither the database nor an embedding model and needs no
 * environment. --apply embeds the RELEASED cards (review.reviewed = true) with
 * the embedding provider and writes them as platform content (no occupation,
 * visible to every trainee and trainer); it also removes the chunks of cards
 * that are no longer released. Only the owner runs --apply, after the cards
 * were checked against the original text (see docs/hai-lerntechniken.md).
 */

import { loadLearningTechniqueCards } from '../src/lib/hai/learningTechniques/loader';
import {
  createIngestDeps,
  ingestLearningTechniques,
  type IngestSummary,
} from '../src/lib/hai/learningTechniques/ingest';

function printPlan(summary: IngestSummary): void {
  console.log('Rang  Freigabe  Zeichen  Chunks  Karte');
  for (const entry of summary.plan) {
    const rank = String(summary.plan.indexOf(entry) + 1).padStart(4);
    console.log(
      `${rank}  ${entry.released ? 'ja      ' : 'nein    '}  ${String(
        entry.characters
      ).padStart(7)}  ${String(entry.chunks).padStart(6)}  ${entry.cardId}`
    );
  }
  console.log(
    `\n${summary.total} Karten, ${summary.released} freigegeben, höchstens ${summary.embeddingCalls} Einbettungsaufrufe.`
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const cards = loadLearningTechniqueCards();
  const plan = await ingestLearningTechniques(cards, null, { dryRun: true });
  printPlan(plan);

  if (!apply) {
    console.log(
      '\nTrockenlauf: keine Datenbank, kein Modell. Mit --apply schreiben.'
    );
    return;
  }

  // Environment only for a real run (GEMINI_API_KEY, HAI_DB_CONNECTION_STRING)
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for --apply');
  }

  const deps = await createIngestDeps();
  const summary = await ingestLearningTechniques(cards, deps, {
    dryRun: false,
  });
  console.log(
    `\nGeschrieben: ${summary.indexed} Chunks, übersprungen: ${summary.skipped}, fehlgeschlagen: ${summary.failed}, entfernt: ${summary.removed}.`
  );
  for (const error of summary.errors) console.error(`  Fehler: ${error}`);
  if (summary.failed > 0 || summary.errors.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
