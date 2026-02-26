const fs = require('fs');
const data = JSON.parse(fs.readFileSync('public/quizzes_production_complete 1.json', 'utf8'));

const dbIds = new Set(
  fs.readFileSync('scripts/db_quiz_ids.txt', 'utf8').trim().split('\n').map(l => l.trim()).filter(l => l)
);

let notInDb = [];
data.forEach(comp => {
  comp.enablers.forEach(en => {
    Object.entries(en.quizzes || {}).forEach(([diff, q]) => {
      if (q === null || q === undefined) return;
      if (q.quizId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(q.quizId)) {
        if (!dbIds.has(q.quizId)) {
          notInDb.push({
            quizId: q.quizId,
            quizTitle: q.quizTitle,
            difficulty: diff,
            enablerTitle: en.enablerTitle,
            enablerID: en.enablerID,
            componentCode: comp.componentCode,
            componentTitle: comp.componentTitle,
            questions: (q.questions || []).length
          });
        }
      }
    });
  });
});

console.log('Quiz IDs in JSON (UUID) NOT in DB:', notInDb.length);
notInDb.forEach(entry => {
  console.log('  quizId:', entry.quizId);
  console.log('  title:', entry.quizTitle);
  console.log('  difficulty:', entry.difficulty);
  console.log('  enablerTitle:', entry.enablerTitle);
  console.log('  enablerID:', entry.enablerID);
  console.log('  component:', entry.componentCode, entry.componentTitle);
  console.log('  questions:', entry.questions);
  console.log('');
});
