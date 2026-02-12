/**
 * Seed Script: MES Softskill Criteria
 *
 * Seeds the database with 19 MES softskill criteria
 * categorized by K-levels (K3, K4, K5) and competency areas
 *
 * Run with: npx tsx scripts/seed-mes-criteria.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { mesSoftskillCriteria } from '../src/db/migrations/schemas/schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const client = postgres(connectionString);
const db = drizzle(client);

const mesCriteria = [
  // K3 Level (Anwenden - Apply)
  {
    code: 'K3.1',
    name: 'Teamfähigkeit',
    description: 'Kooperatives Arbeiten im Team',
    kLevel: 'K3',
    competencyArea: 'SOZIALKOMPETENZ' as const,
    orderIndex: 1,
  },
  {
    code: 'K3.2',
    name: 'Kommunikationsfähigkeit',
    description: 'Effektive mündliche und schriftliche Kommunikation',
    kLevel: 'K3',
    competencyArea: 'SOZIALKOMPETENZ' as const,
    orderIndex: 2,
  },
  {
    code: 'K3.3',
    name: 'Zeitmanagement',
    description: 'Effiziente Planung und Einhaltung von Terminen',
    kLevel: 'K3',
    competencyArea: 'METHODENKOMPETENZ' as const,
    orderIndex: 3,
  },
  {
    code: 'K3.4',
    name: 'Zuverlässigkeit',
    description: 'Verlässlichkeit bei der Aufgabenerfüllung',
    kLevel: 'K3',
    competencyArea: 'PERSONALKOMPETENZ' as const,
    orderIndex: 4,
  },
  {
    code: 'K3.5',
    name: 'Selbstständigkeit',
    description: 'Eigenverantwortliches Arbeiten',
    kLevel: 'K3',
    competencyArea: 'PERSONALKOMPETENZ' as const,
    orderIndex: 5,
  },
  {
    code: 'K3.6',
    name: 'Sorgfalt',
    description: 'Gewissenhafte und präzise Arbeitsweise',
    kLevel: 'K3',
    competencyArea: 'FACHKOMPETENZ' as const,
    orderIndex: 6,
  },

  // K4 Level (Analysieren - Analyze)
  {
    code: 'K4.1',
    name: 'Problemlösefähigkeit',
    description: 'Systematische Problemanalyse und Lösungsfindung',
    kLevel: 'K4',
    competencyArea: 'METHODENKOMPETENZ' as const,
    orderIndex: 7,
  },
  {
    code: 'K4.2',
    name: 'Analytisches Denken',
    description: 'Zerlegung komplexer Probleme in Teilaspekte',
    kLevel: 'K4',
    competencyArea: 'METHODENKOMPETENZ' as const,
    orderIndex: 8,
  },
  {
    code: 'K4.3',
    name: 'Lernbereitschaft',
    description: 'Offenheit für neue Technologien und Methoden',
    kLevel: 'K4',
    competencyArea: 'PERSONALKOMPETENZ' as const,
    orderIndex: 9,
  },
  {
    code: 'K4.4',
    name: 'Kreativität',
    description: 'Entwicklung innovativer Lösungsansätze',
    kLevel: 'K4',
    competencyArea: 'METHODENKOMPETENZ' as const,
    orderIndex: 10,
  },
  {
    code: 'K4.5',
    name: 'Stressresistenz',
    description: 'Gelassenheit und Leistungsfähigkeit unter Druck',
    kLevel: 'K4',
    competencyArea: 'PERSONALKOMPETENZ' as const,
    orderIndex: 11,
  },
  {
    code: 'K4.6',
    name: 'Konfliktfähigkeit',
    description: 'Konstruktiver Umgang mit Meinungsverschiedenheiten',
    kLevel: 'K4',
    competencyArea: 'SOZIALKOMPETENZ' as const,
    orderIndex: 12,
  },
  {
    code: 'K4.7',
    name: 'Kritikfähigkeit',
    description: 'Annahme und Umsetzung von Feedback',
    kLevel: 'K4',
    competencyArea: 'PERSONALKOMPETENZ' as const,
    orderIndex: 13,
  },

  // K5 Level (Bewerten - Evaluate)
  {
    code: 'K5.1',
    name: 'Entscheidungsfähigkeit',
    description: 'Treffen begründeter Entscheidungen',
    kLevel: 'K5',
    competencyArea: 'METHODENKOMPETENZ' as const,
    orderIndex: 14,
  },
  {
    code: 'K5.2',
    name: 'Kundenorientierung',
    description: 'Verständnis und Berücksichtigung von Kundenanforderungen',
    kLevel: 'K5',
    competencyArea: 'SOZIALKOMPETENZ' as const,
    orderIndex: 15,
  },
  {
    code: 'K5.3',
    name: 'Verantwortungsbewusstsein',
    description: 'Übernahme von Verantwortung für Ergebnisse',
    kLevel: 'K5',
    competencyArea: 'PERSONALKOMPETENZ' as const,
    orderIndex: 16,
  },
  {
    code: 'K5.4',
    name: 'Qualitätsbewusstsein',
    description: 'Streben nach hoher Arbeitsqualität',
    kLevel: 'K5',
    competencyArea: 'FACHKOMPETENZ' as const,
    orderIndex: 17,
  },
  {
    code: 'K5.5',
    name: 'Initiative',
    description: 'Proaktives Handeln und Eigeninitiative',
    kLevel: 'K5',
    competencyArea: 'PERSONALKOMPETENZ' as const,
    orderIndex: 18,
  },
  {
    code: 'K5.6',
    name: 'Führungsqualitäten',
    description: 'Fähigkeit zur Koordination und Motivation',
    kLevel: 'K5',
    competencyArea: 'SOZIALKOMPETENZ' as const,
    orderIndex: 19,
  },
];

async function seedMesCriteria() {
  console.log('🌱 Seeding MES Softskill Criteria...');

  try {
    // Delete existing criteria (optional - for clean re-seeding)
    // await db.delete(mesSoftskillCriteria);

    // Insert all 19 criteria
    const inserted = await db.insert(mesSoftskillCriteria).values(mesCriteria).returning();

    console.log(`✅ Successfully seeded ${inserted.length} MES criteria!`);
    console.log('\nBreakdown by competency area:');
    console.log(`  - FACHKOMPETENZ: ${inserted.filter(c => c.competencyArea === 'FACHKOMPETENZ').length}`);
    console.log(`  - METHODENKOMPETENZ: ${inserted.filter(c => c.competencyArea === 'METHODENKOMPETENZ').length}`);
    console.log(`  - SOZIALKOMPETENZ: ${inserted.filter(c => c.competencyArea === 'SOZIALKOMPETENZ').length}`);
    console.log(`  - PERSONALKOMPETENZ: ${inserted.filter(c => c.competencyArea === 'PERSONALKOMPETENZ').length}`);

    console.log('\nBreakdown by K-Level:');
    console.log(`  - K3 (Anwenden): ${inserted.filter(c => c.kLevel === 'K3').length}`);
    console.log(`  - K4 (Analysieren): ${inserted.filter(c => c.kLevel === 'K4').length}`);
    console.log(`  - K5 (Bewerten): ${inserted.filter(c => c.kLevel === 'K5').length}`);

  } catch (error) {
    console.error('❌ Error seeding MES criteria:', error);
    throw error;
  } finally {
    await client.end();
  }
}

seedMesCriteria()
  .then(() => {
    console.log('🎉 Seeding completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to seed:', error);
    process.exit(1);
  });
