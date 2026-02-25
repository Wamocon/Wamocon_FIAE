/**
 * Seed script for Lernfelder (LF1-LF12a) master data
 * Based on official KMK Rahmenlehrplan for Lernzentrum für Auszubildende
 *
 * Run with: npx tsx -r dotenv/config scripts/seed-lernfelder.ts
 */

import db from '../src/db';
import { lernfelder } from '../src/db/migrations/schemas/schema';

// Official FIAE Lernfelder based on 2020 curriculum reform
const LERNFELDER_DATA = [
  // === Year 1 (Ausbildungsjahr 1) - Common IT Professions ===
  {
    code: 'LF1',
    title: 'Das Unternehmen und die eigene Rolle im Betrieb beschreiben',
    description:
      'Kennenlernen des Unternehmens, der Branche und der eigenen Position. Rechtliche Rahmenbedingungen, Arbeitsorganisation und Kommunikation im Team.',
    trainingYear: 1,
    hoursBudget: 40,
    isCommon: true,
    orderIndex: 1,
  },
  {
    code: 'LF2',
    title: 'Arbeitsplätze nach Kundenwunsch ausstatten',
    description:
      'Hardware und Software für Arbeitsplätze auswählen, beschaffen und installieren. Kundenberatung, Dokumentation und Übergabe.',
    trainingYear: 1,
    hoursBudget: 80,
    isCommon: true,
    orderIndex: 2,
  },
  {
    code: 'LF3',
    title: 'Clients in Netzwerke einbinden',
    description:
      'Netzwerkgrundlagen, Client-Konfiguration, Protokolle und Dienste. Lokale Netze planen und einrichten.',
    trainingYear: 1,
    hoursBudget: 80,
    isCommon: true,
    orderIndex: 3,
  },
  {
    code: 'LF4',
    title: 'Schutzbedarfsanalyse im eigenen Arbeitsbereich durchführen',
    description:
      'IT-Sicherheit, Datenschutz, Schutzbedarfsanalyse und Maßnahmenplanung. Grundlagen der Informationssicherheit.',
    trainingYear: 1,
    hoursBudget: 40,
    isCommon: true,
    orderIndex: 4,
  },
  {
    code: 'LF5',
    title: 'Software zur Verwaltung von Daten anpassen',
    description:
      'Datenmodellierung, SQL, relationale Datenbanken. Datenbanken entwerfen, erstellen und abfragen.',
    trainingYear: 1,
    hoursBudget: 80,
    isCommon: true,
    orderIndex: 5,
  },

  // === Year 2 (Ausbildungsjahr 2) - Common IT Professions ===
  {
    code: 'LF6',
    title: 'Serviceanfragen bearbeiten',
    description:
      'First-Level-Support, Ticketsysteme, Kundenkommunkation. Störungen analysieren und beheben.',
    trainingYear: 2,
    hoursBudget: 40,
    isCommon: true,
    orderIndex: 6,
  },
  {
    code: 'LF7',
    title: 'Cyber-physische Systeme ergänzen',
    description:
      'IoT-Grundlagen, Sensoren und Aktoren. Embedded Systems verstehen und in Netzwerke integrieren.',
    trainingYear: 2,
    hoursBudget: 80,
    isCommon: true,
    orderIndex: 7,
  },
  {
    code: 'LF8',
    title: 'Daten systemübergreifend bereitstellen',
    description:
      'APIs, Webservices, Datenformate (JSON, XML). Daten zwischen Systemen austauschen und integrieren.',
    trainingYear: 2,
    hoursBudget: 80,
    isCommon: true,
    orderIndex: 8,
  },
  {
    code: 'LF9',
    title: 'Netzwerke und Dienste bereitstellen',
    description:
      'Server-Administration, Netzwerkdienste (DHCP, DNS), Virtualisierung. Netzwerkinfrastruktur planen und betreiben.',
    trainingYear: 2,
    hoursBudget: 80,
    isCommon: true,
    orderIndex: 9,
  },

  // === Year 2-3 (Ausbildungsjahr 2-3) - FIAE-Specific (Anwendungsentwicklung) ===
  {
    code: 'LF10a',
    title: 'Benutzerschnittstellen gestalten und entwickeln',
    description:
      'UI/UX-Design, Frontend-Entwicklung, Barrierefreiheit. Benutzerfreundliche Oberflächen konzipieren und implementieren.',
    trainingYear: 2,
    hoursBudget: 80,
    isCommon: false, // FIAE-specific
    orderIndex: 10,
  },
  {
    code: 'LF11a',
    title: 'Funktionalität in Anwendungen realisieren',
    description:
      'Softwareentwicklung, Programmierparadigmen, Algorithmen. Backend-Logik implementieren und testen.',
    trainingYear: 3,
    hoursBudget: 80,
    isCommon: false, // FIAE-specific
    orderIndex: 11,
  },
  {
    code: 'LF12a',
    title: 'Kundenspezifische Anwendungsentwicklung durchführen',
    description:
      'Komplette Softwareprojekte von der Anforderungsanalyse bis zur Auslieferung. Projektmanagement und agile Methoden.',
    trainingYear: 3,
    hoursBudget: 80,
    isCommon: false, // FIAE-specific
    orderIndex: 12,
  },
];

async function seedLernfelder() {
  console.log('🎓 Seeding Lernfelder (LF1-LF12a) for FIAE...\n');

  try {
    // Check if already seeded
    const existing = await db.select().from(lernfelder);
    if (existing.length > 0) {
      console.log(
        `⚠️  Found ${existing.length} existing Lernfelder. Skipping seed.`
      );
      console.log('   To re-seed, delete existing records first.');
      return;
    }

    // Insert all Lernfelder
    for (const lf of LERNFELDER_DATA) {
      await db.insert(lernfelder).values(lf);
      console.log(`✅ ${lf.code}: ${lf.title}`);
    }

    console.log(
      `\n✨ Successfully seeded ${LERNFELDER_DATA.length} Lernfelder!`
    );
    console.log('\nLernfelder by year:');
    console.log('  Year 1: LF1-LF5 (common IT)');
    console.log('  Year 2: LF6-LF10a (common + FIAE start)');
    console.log('  Year 3: LF11a-LF12a (FIAE-specific)');
  } catch (error) {
    console.error('❌ Error seeding Lernfelder:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run if executed directly
seedLernfelder();
