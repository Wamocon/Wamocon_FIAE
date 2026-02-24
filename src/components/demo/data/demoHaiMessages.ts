export interface DemoHaiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export const preloadedConversation: DemoHaiMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: 'Hallo HAI! Kannst du mir bei SQL-Joins helfen?',
    timestamp: '14:23',
  },
  {
    id: 'm2',
    role: 'assistant',
    content: `Klar, helfe ich dir gerne! \ud83e\udd88

**SQL-Joins** verbinden Daten aus mehreren Tabellen. Hier die wichtigsten Typen:

- **INNER JOIN** \u2014 Gibt nur \u00fcbereinstimmende Zeilen zur\u00fcck
- **LEFT JOIN** \u2014 Alle Zeilen der linken Tabelle + \u00dcbereinstimmungen rechts
- **RIGHT JOIN** \u2014 Alle Zeilen der rechten Tabelle + \u00dcbereinstimmungen links
- **FULL OUTER JOIN** \u2014 Alle Zeilen beider Tabellen

Beispiel f\u00fcr einen INNER JOIN:
\`\`\`sql
SELECT k.name, b.datum
FROM kunden k
INNER JOIN bestellungen b ON k.id = b.kunden_id;
\`\`\`

M\u00f6chtest du ein bestimmtes Szenario \u00fcben?`,
    timestamp: '14:23',
  },
  {
    id: 'm3',
    role: 'user',
    content: 'Ja, wann benutze ich LEFT JOIN statt INNER JOIN?',
    timestamp: '14:25',
  },
  {
    id: 'm4',
    role: 'assistant',
    content: `Gute Frage! Der Unterschied ist wichtig:

**INNER JOIN** \u2014 Wenn du **nur** Datens\u00e4tze brauchst, die in **beiden** Tabellen existieren.
> *\u201eZeig mir alle Kunden, die eine Bestellung haben.\u201c*

**LEFT JOIN** \u2014 Wenn du **alle** Datens\u00e4tze der linken Tabelle brauchst, **auch wenn** es keinen passenden Eintrag rechts gibt.
> *\u201eZeig mir alle Kunden \u2014 und ob sie Bestellungen haben.\u201c*

\`\`\`sql
-- Alle Kunden, auch ohne Bestellung (NULL bei fehlenden)
SELECT k.name, b.datum
FROM kunden k
LEFT JOIN bestellungen b ON k.id = b.kunden_id;
\`\`\`

\ud83d\udca1 **Faustregel:** LEFT JOIN, wenn du keine Daten verlieren willst. INNER JOIN, wenn du nur vollst\u00e4ndige Verkn\u00fcpfungen brauchst.

Das kommt auch in deinem n\u00e4chsten Quiz zu **Lernfeld 5** vor!`,
    timestamp: '14:25',
  },
];

export const demoResponses = [
  'Das ist eine tolle Frage! \ud83e\udd88 In der Demo kann ich leider keine echten Antworten geben, aber im echten HAI-Chat helfe ich dir gerne mit deinem Lernstoff weiter!',
  'Super, dass du dich daf\u00fcr interessierst! \ud83d\udcda Im echten System kann ich auf deine Kursinhalte und Fortschritte zugreifen, um dir personalisierte Hilfe zu geben.',
  'Gute Frage! \ud83d\udc4d Erstelle ein Konto, um HAI im Vollmodus zu nutzen \u2014 ich kann dann auf deine Lernmaterialien, Quizze und den gesamten Ausbildungsrahmenplan zugreifen!',
  'Im echten HAI-System habe ich Zugriff auf alle deine Kursmaterialien und kann dir gezielt bei Pr\u00fcfungsvorbereitung helfen. Melde dich an, um loszulegen! \ud83d\ude80',
];
