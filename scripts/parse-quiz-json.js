const fs = require('fs');
const data = JSON.parse(fs.readFileSync('c:/Users/Yash Bhesaniya/OneDrive - WAMOCON GmbH/Desktop/WMC/Wamocon_FIAE/public/quizzes_production_complete 1.json', 'utf8'));

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validTriples = [];
const skippedEntries = [];

for (const component of data) {
  for (const enabler of component.enablers) {
    const enablerID = enabler.enablerID;
    const quizzes = enabler.quizzes;

    for (const [difficulty, quizData] of Object.entries(quizzes)) {
      // quizData can be null
      if (!quizData) {
        skippedEntries.push({ enablerID, difficulty, quizId: null, reason: 'null-quiz-data' });
        continue;
      }

      const quizId = quizData.quizId;

      if (!quizId || quizId === '-' || !UUID_REGEX.test(quizId)) {
        skippedEntries.push({ enablerID, difficulty, quizId, reason: quizId === '-' ? 'dash' : 'non-UUID' });
      } else {
        validTriples.push({ enablerID, quizId, difficulty, quizTitle: quizData.quizTitle });
      }
    }
  }
}

console.log('Valid triples count:', validTriples.length);
console.log('Skipped entries count:', skippedEntries.length);
console.log('');
console.log('Skipped entries:');
skippedEntries.forEach(e => console.log(JSON.stringify(e)));
console.log('');
console.log('First 5 valid triples:');
validTriples.slice(0, 5).forEach(t => console.log(JSON.stringify(t)));
console.log('');
console.log('All valid triples JSON:');
console.log(JSON.stringify(validTriples));
