const fs = require('fs');
const data = JSON.parse(fs.readFileSync('public/quizzes_production_complete 1.json', 'utf8'));

// Collect all quiz IDs from JSON
let jsonQuizIds = new Set();
let nonUuidIds = [];

data.forEach(comp => {
  comp.enablers.forEach(en => {
    Object.values(en.quizzes || {}).forEach(q => {
      if (q === null || q === undefined) return;
      if (q.quizId && q.quizId !== '-') {
        // Check if it's a proper UUID
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(q.quizId)) {
          jsonQuizIds.add(q.quizId);
        } else {
          nonUuidIds.push(q.quizId);
        }
      }
    });
  });
});

console.log('Valid UUID quiz IDs in JSON:', jsonQuizIds.size);
console.log('Non-UUID quiz IDs (e.g. named):', nonUuidIds.length, '|', nonUuidIds.join(', '));

// Write IDs file for SQL comparison
fs.writeFileSync('scripts/json_quiz_ids.txt', [...jsonQuizIds].join('\n'));
console.log('Written to scripts/json_quiz_ids.txt');
