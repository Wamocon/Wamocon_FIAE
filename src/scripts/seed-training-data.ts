import 'dotenv/config';
import db from '../db';
import { trainingComponents, trainingUseCases } from '../db/migrations/schemas/schema';
import { eq } from 'drizzle-orm';

/**
 * LFA Training Data Seed
 * Based on user-provided "Betrieblicher Ausbildungsrahmenplan" text.
 * 
 * PHASES (mapped to trainingYear for grouping):
 * 1 = 1. bis 18. Monat
 * 2 = 19. bis 36. Monat
 * 3 = Gesamte Ausbildung (Integrativ)
 */

const componentsData = [
    // ==================================================================================
    // PHASE 1: 1. bis 18. Monat (Abschnitt A & B) -> trainingYear: 1
    // ==================================================================================

    // §4.2.1
    {
        code: '1-P1',
        title: 'Planen, Vorbereiten und Durchführen von Arbeitsaufgaben in Abstimmung mit den kundenspezifischen Geschäfts- und Leistungsprozessen',
        totalWeeks: 12,
        totalHours: 480,
        trainingYear: 1, // Phase 1
        orderIndex: 1
    },
    // §4.2.2 P1
    {
        code: '2-P1',
        title: 'Informieren und Beraten von Kunden und Kundinnen',
        totalWeeks: 3,
        totalHours: 120,
        trainingYear: 1,
        orderIndex: 2
    },
    // §4.2.3 P1
    {
        code: '3-P1',
        title: 'Beurteilen marktgängiger IT-Systeme und kundenspezifischer Lösungen',
        totalWeeks: 10,
        totalHours: 400,
        trainingYear: 1,
        orderIndex: 3
    },
    // §4.2.4 P1
    {
        code: '4-P1',
        title: 'Entwickeln, Erstellen und Betreuen von IT-Lösungen',
        totalWeeks: 5,
        totalHours: 200,
        trainingYear: 1,
        orderIndex: 4
    },
    // §4.2.5 P1
    {
        code: '5-P1',
        title: 'Durchführen und Dokumentieren von qualitätssichernden Maßnahmen',
        totalWeeks: 4,
        totalHours: 160,
        trainingYear: 1,
        orderIndex: 5
    },
    // §4.2.6 P1
    {
        code: '6-P1',
        title: 'Umsetzen, Integrieren und Prüfen von Maßnahmen zur IT-Sicherheit und zum Datenschutz',
        totalWeeks: 6,
        totalHours: 240,
        trainingYear: 1,
        orderIndex: 6
    },
    // §4.2.7 P1
    {
        code: '7-P1',
        title: 'Erbringen der Leistungen und Auftragsabschluss',
        totalWeeks: 7,
        totalHours: 280,
        trainingYear: 1,
        orderIndex: 7
    },
    // §4.2.8 P1
    {
        code: '8-P1',
        title: 'Betreiben von IT-Systemen',
        totalWeeks: 3,
        totalHours: 120,
        trainingYear: 1,
        orderIndex: 8
    },
    // §4.2.10 P1
    {
        code: '10-P1',
        title: 'Programmieren von Softwarelösungen',
        totalWeeks: 5,
        totalHours: 200,
        trainingYear: 1,
        orderIndex: 9
    },
    // §4.3.1 P1 (AE Specific)
    {
        code: 'AE1-P1',
        title: 'Konzipieren und Umsetzen von kundenspezifischen Softwareanwendungen',
        totalWeeks: 15,
        totalHours: 600,
        trainingYear: 1,
        orderIndex: 10
    },
    // §4.3.2 P1 (AE Specific)
    {
        code: 'AE2-P1',
        title: 'Sicherstellen der Qualität von Softwareanwendungen',
        totalWeeks: 5,
        totalHours: 200,
        trainingYear: 1,
        orderIndex: 11
    },
    // §4.7.5 P1 (Integrative in first 18 months per text)
    {
        code: 'INT5-P1',
        title: 'Vernetztes Zusammenarbeiten unter Nutzung digitaler Medien',
        totalWeeks: 3,
        totalHours: 120,
        trainingYear: 1,
        orderIndex: 12
    },

    // ==================================================================================
    // PHASE 2: 19. bis 36. Monat (Abschnitt A & B) -> trainingYear: 2
    // ==================================================================================

    // §4.2.2 P2
    {
        code: '2-P2',
        title: 'Informieren und Beraten von Kunden und Kundinnen',
        totalWeeks: 2,
        totalHours: 80,
        trainingYear: 2, // Phase 2
        orderIndex: 13
    },
    // §4.2.3 P2
    {
        code: '3-P2',
        title: 'Beurteilen marktgängiger IT-Systeme und kundenspezifischer Lösungen',
        totalWeeks: 5,
        totalHours: 200,
        trainingYear: 2,
        orderIndex: 14
    },
    // §4.2.4 P2
    {
        code: '4-P2',
        title: 'Entwickeln, Erstellen und Betreuen von IT-Lösungen',
        totalWeeks: 7,
        totalHours: 280,
        trainingYear: 2,
        orderIndex: 15
    },
    // §4.2.5 P2
    {
        code: '5-P2',
        title: 'Durchführen und Dokumentieren von qualitätssichernden Maßnahmen',
        totalWeeks: 8,
        totalHours: 320,
        trainingYear: 2,
        orderIndex: 16
    },
    // §4.2.6 P2
    {
        code: '6-P2',
        title: 'Umsetzen, Integrieren und Prüfen von Maßnahmen zur IT-Sicherheit und zum Datenschutz',
        totalWeeks: 6,
        totalHours: 240,
        trainingYear: 2,
        orderIndex: 17
    },
    // §4.2.8 P2
    {
        code: '8-P2',
        title: 'Betreiben von IT-Systemen',
        totalWeeks: 3,
        totalHours: 120,
        trainingYear: 2,
        orderIndex: 18
    },
    // §4.2.9 P2
    {
        code: '9-P2',
        title: 'Inbetriebnehmen von Speicherlösungen',
        totalWeeks: 5,
        totalHours: 200,
        trainingYear: 2,
        orderIndex: 19
    },
    // §4.2.10 P2
    {
        code: '10-P2',
        title: 'Programmieren von Softwarelösungen',
        totalWeeks: 10,
        totalHours: 400,
        trainingYear: 2,
        orderIndex: 20
    },
    // §4.3.1 P2 (AE Specific)
    {
        code: 'AE1-P2',
        title: 'Konzipieren und Umsetzen von kundenspezifischen Softwareanwendungen',
        totalWeeks: 25,
        totalHours: 1000,
        trainingYear: 2,
        orderIndex: 21
    },
    // §4.3.2 P2 (AE Specific)
    {
        code: 'AE2-P2',
        title: 'Sicherstellen der Qualität von Softwareanwendungen',
        totalWeeks: 7,
        totalHours: 280,
        trainingYear: 2,
        orderIndex: 22
    },

    // ==================================================================================
    // PHASE 3: Während der gesamten Ausbildung (Integrativ) -> trainingYear: 3
    // ==================================================================================

    {
        code: 'INT1',
        title: 'Berufsbildung, Arbeits- und Tarifrecht',
        totalWeeks: 0,
        totalHours: 0,
        trainingYear: 3, // Group 3
        orderIndex: 23
    },
    {
        code: 'INT2',
        title: 'Aufbau und Organisation des Ausbildungsbetriebes',
        totalWeeks: 0,
        totalHours: 0,
        trainingYear: 3,
        orderIndex: 24
    },
    {
        code: 'INT3',
        title: 'Sicherheit und Gesundheitsschutz bei der Arbeit',
        totalWeeks: 0,
        totalHours: 0,
        trainingYear: 3,
        orderIndex: 25
    },
    {
        code: 'INT4',
        title: 'Umweltschutz',
        totalWeeks: 0,
        totalHours: 0,
        trainingYear: 3,
        orderIndex: 26
    },
];

// Use cases mapped to codes
const useCasesMap: Record<string, { letter: string; description: string; plannedHours: number }[]> = {
    // Phase 1 (1-18 Mo)
    '1-P1': [
        { letter: 'a', description: 'Grundsätze und Methoden des Projektmanagements anwenden', plannedHours: 80 },
        { letter: 'b', description: 'Auftragsunterlagen und Durchführbarkeit des Auftrags prüfen, insbesondere in Hinblick auf rechtliche, wirtschaftliche und terminliche Vorgaben, und den Auftrag mit den betrieblichen Prozessen und Möglichkeiten abstimmen', plannedHours: 40 },
        { letter: 'c', description: 'Zeitplan und Reihenfolge der Arbeitsschritte für den eigenen Arbeitsbereich festlegen', plannedHours: 40 },
        { letter: 'd', description: 'Termine planen und abstimmen sowie Terminüberwachung durchführen', plannedHours: 40 },
        { letter: 'e', description: 'Probleme analysieren und als Aufgabe definieren sowie Lösungsalternativen entwickeln und beurteilen', plannedHours: 80 },
        { letter: 'f', description: 'Arbeits- und Organisationsmittel wirtschaftlich und ökologisch unter Berücksichtigung der vorhandenen Ressourcen und der Budgetvorgaben einsetzen', plannedHours: 60 },
        { letter: 'g', description: 'Aufgaben im Team sowie mit internen und externen Kunden und Kundinnen planen und abstimmen', plannedHours: 60 },
        { letter: 'h', description: 'Betriebswirtschaftlich relevante Daten erheben und bewerten und dabei Geschäfts- und Leistungsprozesse berücksichtigen', plannedHours: 40 },
        { letter: 'i', description: 'Eigene Vorgehensweise sowie die Aufgabendurchführung im Team reflektieren und bei der Verbesserung der Arbeitsprozesse mitwirken', plannedHours: 40 },
    ],
    '2-P1': [
        { letter: 'a', description: 'Im Rahmen der Marktbeobachtung Preise, Leistungen und Konditionen von Wettbewerbern vergleichen', plannedHours: 20 },
        { letter: 'b', description: 'Bedarfe von Kunden und Kundinnen feststellen sowie Zielgruppen unterscheiden', plannedHours: 20 },
        { letter: 'c', description: 'Kunden unter Beachtung von Kommunikationsregeln informieren sowie Sachverhalte präsentieren und dabei deutsche und englische Fachbegriffe anwenden', plannedHours: 40 },
        { letter: 'd', description: 'Maßnahmen für Marketing und Vertrieb unterstützen', plannedHours: 20 },
        { letter: 'e', description: 'Informationsquellen auch in englischer Sprache aufgabenbezogen auswerten und für die Kundeninformation nutzen', plannedHours: 20 },
    ],
    '3-P1': [
        { letter: 'a', description: 'Marktgängige IT-Systeme für unterschiedliche Einsatzbereiche hinsichtlich Leistungsfähigkeit, Wirtschaftlichkeit und Barrierefreiheit beurteilen', plannedHours: 240 },
        { letter: 'b', description: 'Angebote zu IT-Komponenten, IT-Produkten und IT-Dienstleistungen einholen und bewerten sowie Spezifikationen und Konditionen vergleichen', plannedHours: 160 },
    ],
    '4-P1': [
        { letter: 'a', description: 'IT-Systeme zur Bearbeitung betrieblicher Fachaufgaben analysieren sowie unter Beachtung insbesondere von Lizenzmodellen und Urheberrechten und Barrierefreiheit konzeptionieren, konfigurieren, testen und dokumentieren', plannedHours: 140 },
        { letter: 'b', description: 'Programmiersprachen, insbesondere prozedurale und objektorientierte Programmiersprachen, unterscheiden', plannedHours: 60 },
    ],
    '5-P1': [
        { letter: 'a', description: 'Betriebliche Qualitätssicherungssysteme im eigenen Arbeitsbereich anwenden und Qualitätssicherungsmaßnahmen projektbegleitend durchführen und dokumentieren', plannedHours: 160 },
    ],
    '6-P1': [
        { letter: 'a', description: 'Betriebliche Vorgaben und rechtliche Regelungen zur IT-Sicherheit und zum Datenschutz einhalten', plannedHours: 80 },
        { letter: 'b', description: 'Sicherheitsanforderungen von IT-Systemen analysieren und Maßnahmen zur IT-Sicherheit ableiten, abstimmen, umsetzen und evaluieren', plannedHours: 160 },
    ],
    '7-P1': [
        { letter: 'a', description: 'Leistungen nach betrieblichen und vertraglichen Vorgaben dokumentieren', plannedHours: 40 },
        { letter: 'b', description: 'Leistungserbringung unter Berücksichtigung der organisatorischen und terminlichen Vorgaben mit Kunden und Kundinnen abstimmen und kontrollieren', plannedHours: 60 },
        { letter: 'c', description: 'Veränderungsprozesse begleiten und unterstützen', plannedHours: 40 },
        { letter: 'd', description: 'Kunden und Kundinnen in die Nutzung von Produkten und Dienstleistungen einweisen', plannedHours: 40 },
        { letter: 'e', description: 'Leistungen und Dokumentationen an Kunden und Kundinnen übergeben sowie Abnahmeprotokolle anfertigen', plannedHours: 60 },
        { letter: 'f', description: 'Kosten für erbrachte Leistungen erfassen sowie im Zeitvergleich und im Soll-Ist-Vergleich bewerten', plannedHours: 40 },
    ],
    '8-P1': [
        { letter: 'a', description: 'Netzwerkkonzepte für unterschiedliche Anwendungsgebiete unterscheiden', plannedHours: 20 },
        { letter: 'b', description: 'Datenaustausch von vernetzten Systemen realisieren', plannedHours: 40 },
        { letter: 'c', description: 'Verfügbarkeit und Ausfallwahrscheinlichkeiten analysieren und Lösungsvorschläge unterbreiten', plannedHours: 30 },
        { letter: 'd', description: 'Maßnahmen zur präventiven Wartung und zur Störungsvermeidung einleiten und durchführen', plannedHours: 30 },
    ],
    '10-P1': [
        { letter: 'a', description: 'Programmspezifikationen festlegen, Datenmodelle und Strukturen aus fachlichen Anforderungen ableiten sowie Schnittstellen festlegen', plannedHours: 80 },
        { letter: 'b', description: 'Programmiersprachen auswählen und unterschiedliche Programmiersprachen anwenden', plannedHours: 120 },
    ],
    'AE1-P1': [
        { letter: 'a', description: 'Vorgehensmodelle und -methoden sowie Entwicklungsumgebungen und -bibliotheken auswählen und einsetzen', plannedHours: 240 },
        { letter: 'b', description: 'Analyse- und Designverfahren anwenden', plannedHours: 120 },
        { letter: 'c', description: 'Benutzerschnittstellen ergonomisch gestalten und an Kundenanforderungen anpassen', plannedHours: 240 },
    ],
    'AE2-P1': [
        { letter: 'a', description: 'Sicherheitsaspekte bei der Entwicklung von Softwareanwendungen berücksichtigen', plannedHours: 60 },
        { letter: 'b', description: 'Datenintegrität mithilfe von Werkzeugen sicherstellen', plannedHours: 120 },
        { letter: 'c', description: 'Modultests erstellen und durchführen', plannedHours: 20 },
    ],
    'INT5-P1': [
        { letter: 'a', description: 'Gegenseitige Wertschätzung unter Berücksichtigung gesellschaftlicher Vielfalt bei betrieblichen Abläufen praktizieren', plannedHours: 20 },
        { letter: 'b', description: 'Strategien zum verantwortungsvollen Umgang mit digitalen Medien anwenden und im virtuellen Raum unter Wahrung der Persönlichkeitsrechte Dritter zusammenarbeiten', plannedHours: 40 },
        { letter: 'c', description: 'Insbesondere bei der Speicherung, Darstellung und Weitergabe digitaler Inhalte die Auswirkungen des eigenen Kommunikations- und Informationsverhaltens berücksichtigen', plannedHours: 30 },
        { letter: 'd', description: 'Bei der Beurteilung, Entwicklung, Umsetzung und Betreuung von IT-Lösungen ethische Aspekte reflektieren', plannedHours: 30 },
    ],

    // Phase 2 (19-36 Mo)
    '2-P2': [
        { letter: 'a', description: 'Gespräche situationsgerecht führen und Kunden und Kundinnen unter Berücksichtigung der Kundeninteressen beraten', plannedHours: 30 },
        { letter: 'b', description: 'Kundenbeziehungen unter Beachtung rechtlicher Regelungen und betrieblicher Grundsätze gestalten', plannedHours: 20 },
        { letter: 'c', description: 'Daten und Sachverhalte interpretieren, multimedial aufbereiten und situationsgerecht unter Nutzung digitaler Werkzeuge und unter Berücksichtigung der betrieblichen Vorgaben präsentieren', plannedHours: 30 },
    ],
    '3-P2': [
        { letter: 'a', description: 'Technologische Entwicklungstrends von IT-Systemen feststellen sowie ihre wirtschaftlichen, sozialen und beruflichen Auswirkungen aufzeigen', plannedHours: 100 },
        { letter: 'b', description: 'Veränderungen von Einsatzfeldern für IT-Systeme aufgrund technischer, wirtschaftlicher und gesellschaftlicher Entwicklungen feststellen', plannedHours: 100 },
    ],
    '4-P2': [
        { letter: 'a', description: 'Systematisch Fehler erkennen, analysieren und beheben', plannedHours: 80 },
        { letter: 'b', description: 'Algorithmen formulieren und Anwendungen in einer Programmiersprache erstellen', plannedHours: 100 },
        { letter: 'c', description: 'Datenbankmodelle unterscheiden, Daten organisieren und speichern sowie Abfragen erstellen', plannedHours: 100 },
    ],
    '5-P2': [
        { letter: 'a', description: 'Ursachen von Qualitätsmängeln systematisch feststellen, beseitigen und dokumentieren', plannedHours: 200 },
        { letter: 'b', description: 'Im Rahmen eines Verbesserungsprozesses die Zielerreichung kontrollieren, insbesondere einen Soll-Ist-Vergleich durchführen', plannedHours: 120 },
    ],
    '6-P2': [
        { letter: 'a', description: 'Bedrohungsszenarien erkennen und Schadenspotenziale unter Berücksichtigung wirtschaftlicher und technischer Kriterien einschätzen', plannedHours: 80 },
        { letter: 'b', description: 'Kunden und Kundinnen im Hinblick auf Anforderungen an die IT-Sicherheit und an den Datenschutz beraten', plannedHours: 40 },
        { letter: 'c', description: 'Wirksamkeit und Effizienz der umgesetzten Maßnahmen zur IT-Sicherheit und zum Datenschutz prüfen', plannedHours: 120 },
    ],
    '8-P2': [
        { letter: 'a', description: 'Störungsmeldungen aufnehmen und analysieren sowie Maßnahmen zur Störungsbeseitigung ergreifen', plannedHours: 60 },
        { letter: 'b', description: 'Dokumentationen zielgruppengerecht und barrierefrei anfertigen, bereitstellen und pflegen, insbesondere technische Dokumentationen, System- sowie Benutzerdokumentationen', plannedHours: 60 },
    ],
    '9-P2': [
        { letter: 'a', description: 'Sicherheitsmechanismen, insbesondere Zugriffsmöglichkeiten und -rechte, festlegen und implementieren', plannedHours: 200 },
        { letter: 'b', description: 'Speicherlösungen, insbesondere Datenbanksysteme, integrieren', plannedHours: 0 }, // No hours specified in text
    ],
    '10-P2': [
        { letter: 'a', description: 'Teilaufgaben von IT-Systemen automatisieren', plannedHours: 400 },
    ],
    'AE1-P2': [
        { letter: 'a', description: 'Anwendungslösungen unter Berücksichtigung der bestehenden Systemarchitektur entwerfen und realisieren', plannedHours: 400 },
        { letter: 'b', description: 'Bestehende Anwendungslösungen anpassen', plannedHours: 240 },
        { letter: 'c', description: 'Datenaustausch zwischen Systemen realisieren und unterschiedliche Datenquellen nutzen', plannedHours: 200 },
        { letter: 'd', description: 'Komplexe Abfragen aus unterschiedlichen Datenquellen durchführen und Datenbestandsberichte erstellen', plannedHours: 160 },
    ],
    'AE2-P2': [
        { letter: 'a', description: 'Werkzeuge zur Versionsverwaltung einsetzen', plannedHours: 80 },
        { letter: 'b', description: 'Testkonzepte erstellen und Tests durchführen sowie Testergebnisse bewerten und dokumentieren', plannedHours: 120 },
        { letter: 'c', description: 'Daten und Sachverhalte aus Tests multimedial aufbereiten und situationsgerecht unter Nutzung digitaler Werkzeuge und unter Beachtung der betrieblichen Vorgaben präsentieren', plannedHours: 80 },
    ],

    // Integrative (All Years)
    'INT1': [
        { letter: 'a', description: 'Wesentliche Inhalte und Bestandteile des Ausbildungsvertrages darstellen, Rechte und Pflichten aus dem Ausbildungsvertrag feststellen und Aufgaben der Beteiligten im dualen System beschreiben', plannedHours: 0 },
        { letter: 'b', description: 'Den betrieblichen Ausbildungsplan mit der Ausbildungsordnung vergleichen', plannedHours: 0 },
        { letter: 'c', description: 'Arbeits-, sozial- und mitbestimmungsrechtliche Vorschriften sowie für den Arbeitsbereich geltende Tarif- und Arbeitszeitregelungen beachten', plannedHours: 0 },
        { letter: 'd', description: 'Positionen der eigenen Entgeltabrechnung erklären', plannedHours: 0 },
        { letter: 'e', description: 'Chancen und Anforderungen des lebensbegleitenden Lernens für die berufliche und persönliche Entwicklung begründen und die eigenen Kompetenzen weiterentwickeln', plannedHours: 0 },
        { letter: 'f', description: 'Lern- und Arbeitstechniken sowie Methoden des selbstgesteuerten Lernens anwenden und beruflich relevante Informationsquellen nutzen', plannedHours: 0 },
        { letter: 'g', description: 'Berufliche Aufstiegs- und Weiterentwicklungsmöglichkeiten darstellen', plannedHours: 0 },
        { letter: 'h', description: 'Die Rechtsform und den organisatorischen Aufbau des Ausbildungsbetriebes erläutern', plannedHours: 0 },
    ],
    'INT2': [
        { letter: 'a', description: 'Aufbau und Organisation des Ausbildungsbetriebes mit seinen Aufgaben und Zuständigkeiten sowie die Zusammenhänge zwischen den Geschäftsprozessen erläutern', plannedHours: 0 },
        { letter: 'b', description: 'Beziehungen des Ausbildungsbetriebes und seiner Beschäftigten zu Wirtschaftsorganisationen, Berufsvertretungen und Gewerkschaften nennen', plannedHours: 0 },
        { letter: 'c', description: 'Grundlagen, Aufgaben und Arbeitsweise der betriebsverfassungsrechtlichen Organe des Ausbildungsbetriebes beschreiben', plannedHours: 0 },
    ],
    'INT3': [
        { letter: 'a', description: 'Gefährdung von Sicherheit und Gesundheit am Arbeitsplatz feststellen und Maßnahmen zur Vermeidung der Gefährdung ergreifen', plannedHours: 0 },
        { letter: 'b', description: 'Berufsbezogene Arbeitsschutz- und Unfallverhütungsvorschriften anwenden', plannedHours: 0 },
        { letter: 'c', description: 'Verhaltensweisen bei Unfällen beschreiben sowie erste Maßnahmen einleiten', plannedHours: 0 },
        { letter: 'd', description: 'Vorschriften des vorbeugenden Brandschutzes anwenden sowie Verhaltensweisen bei Bränden beschreiben und Maßnahmen zur Brandbekämpfung ergreifen', plannedHours: 0 },
    ],
    'INT4': [
        { letter: 'a', description: 'Mögliche Umweltbelastungen durch den Ausbildungsbetrieb und seinen Beitrag zum Umweltschutz an Beispielen erklären', plannedHours: 0 },
        { letter: 'b', description: 'Für den Ausbildungsbetrieb geltende Regelungen des Umweltschutzes anwenden', plannedHours: 0 },
        { letter: 'c', description: 'Möglichkeiten der wirtschaftlichen und umweltschonenden Energie- und Materialverwendung nutzen', plannedHours: 0 },
        { letter: 'd', description: 'Abfälle vermeiden sowie Stoffe und Materialien einer umweltschonenden Entsorgung zuführen', plannedHours: 0 },
    ],
};

async function main() {
    console.log('========================================');
    console.log('LFA Training Data Seeder V3');
    console.log('========================================\n');

    console.log('Deleting existing data...');

    try {
        // Delete existing data to avoid duplicates
        await db.delete(trainingUseCases);
        await db.delete(trainingComponents);
        console.log('Existing data cleared.\n');
    } catch (e) {
        console.log('No existing data to clear or error:', e);
    }

    try {
        // Insert all components
        console.log('Inserting ' + componentsData.length + ' training components...\n');

        for (const c of componentsData) {
            await db.insert(trainingComponents).values(c);
            let phaseStr = '';
            if (c.trainingYear === 1) phaseStr = ' (1-18 Mo)';
            else if (c.trainingYear === 2) phaseStr = ' (19-36 Mo)';
            else phaseStr = ' (Integrativ)';

            console.log(`  ✓ ${c.code}: ${c.title.substring(0, 50)}...${phaseStr}`);
        }
        console.log('');

        // Get all components
        const allComponents = await db.select().from(trainingComponents);
        console.log(`Total components in database: ${allComponents.length}\n`);

        // Insert use cases for each component
        let totalUseCases = 0;
        console.log('Inserting training use cases...\n');

        for (const comp of allComponents) {
            const useCasesForComponent = useCasesMap[comp.code];
            if (!useCasesForComponent) {
                console.log(`  - ${comp.code}: No use cases defined`);
                continue;
            }

            console.log(`  ${comp.code} (${useCasesForComponent.length} use cases):`);
            for (let i = 0; i < useCasesForComponent.length; i++) {
                const uc = useCasesForComponent[i];
                await db.insert(trainingUseCases).values({
                    componentId: comp.id,
                    letter: uc.letter,
                    description: uc.description,
                    plannedHours: uc.plannedHours,
                    orderIndex: i + 1,
                });
                totalUseCases++;
            }
        }

        // Get final counts
        const finalUseCases = await db.select().from(trainingUseCases);

        console.log('\n========================================');
        console.log('SEED COMPLETE');
        console.log('========================================');
        console.log(`Components: ${allComponents.length}`);
        console.log(`Use Cases: ${finalUseCases.length}`);
        console.log('========================================\n');

    } catch (err) {
        console.error('Error:', err);
    }

    process.exit(0);
}

main();
