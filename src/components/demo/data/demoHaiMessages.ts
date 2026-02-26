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
    content: `Klar, helfe ich dir gerne! 👋

**SQL-Joins** verbinden Daten aus mehreren Tabellen. Hier die wichtigsten Typen:

- **INNER JOIN** — Gibt nur übereinstimmende Zeilen zurück
- **LEFT JOIN** — Alle Zeilen der linken Tabelle + Übereinstimmungen rechts
- **RIGHT JOIN** — Alle Zeilen der rechten Tabelle + Übereinstimmungen links
- **FULL OUTER JOIN** — Alle Zeilen beider Tabellen

Beispiel für einen INNER JOIN:
\`\`\`sql
SELECT k.name, b.datum
FROM kunden k
INNER JOIN bestellungen b ON k.id = b.kunden_id;
\`\`\`

Möchtest du ein bestimmtes Szenario üben?`,
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

**INNER JOIN** — Wenn du **nur** Datensätze brauchst, die in **beiden** Tabellen existieren.
> *„Zeig mir alle Kunden, die eine Bestellung haben.“*

**LEFT JOIN** — Wenn du **alle** Datensätze der linken Tabelle brauchst, **auch wenn** es keinen passenden Eintrag rechts gibt.
> *„Zeig mir alle Kunden — und ob sie Bestellungen haben.“*

\`\`\`sql
-- Alle Kunden, auch ohne Bestellung (NULL bei fehlenden)
SELECT k.name, b.datum
FROM kunden k
LEFT JOIN bestellungen b ON k.id = b.kunden_id;
\`\`\`

💡 **Faustregel:** LEFT JOIN, wenn du keine Daten verlieren willst. INNER JOIN, wenn du nur vollständige Verknüpfungen brauchst.

Das kommt auch in deinem nächsten Quiz zu **Lernfeld 5** vor!`,
    timestamp: '14:25',
  },
];

export const demoResponses = [
  'Das ist eine tolle Frage! 👋 In der Demo kann ich leider keine echten Antworten geben, aber im echten HAI-Chat helfe ich dir gerne mit deinem Lernstoff weiter!',
  'Super, dass du dich dafür interessierst! 📚 Im echten System kann ich auf deine Kursinhalte und Fortschritte zugreifen, um dir personalisierte Hilfe zu geben.',
  'Gute Frage! 👍 Erstelle ein Konto, um HAI im Vollmodus zu nutzen — ich kann dann auf deine Lernmaterialien, Quizze und den gesamten Ausbildungsrahmenplan zugreifen!',
  'Im echten HAI-System habe ich Zugriff auf alle deine Kursmaterialien und kann dir gezielt bei Prüfungsvorbereitung helfen. Melde dich an, um loszulegen! 🚀',
];
