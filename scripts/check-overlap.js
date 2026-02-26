const fs = require('fs');
const { execSync } = require('child_process');

const data = JSON.parse(fs.readFileSync('public/quizzes_production_complete 1.json', 'utf8'));

// Collect all quiz IDs from JSON
let jsonQuizIds = new Set();
let nonUuidIds = new Set();

data.forEach(comp => {
  comp.enablers.forEach(en => {
    Object.values(en.quizzes || {}).forEach(q => {
      if (q === null || q === undefined) return;
      if (q.quizId && q.quizId !== '-') {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(q.quizId)) {
          jsonQuizIds.add(q.quizId);
        } else {
          nonUuidIds.add(q.quizId);
        }
      }
    });
  });
});

// Read DB quiz IDs from file
const dbQuizIds = new Set(
  fs.readFileSync('scripts/db_quiz_ids.txt', 'utf8').trim().split('\n').map(l => l.trim()).filter(l => l)
);

const alreadyInDb = [...jsonQuizIds].filter(id => dbQuizIds.has(id));
const notInDb = [...jsonQuizIds].filter(id => !dbQuizIds.has(id));
const inDbButNotInJson = [...dbQuizIds].filter(id => !jsonQuizIds.has(id));

console.log('=== OVERLAP ANALYSIS ===');
console.log('JSON valid UUID quiz IDs:', jsonQuizIds.size);
console.log('JSON non-UUID quiz IDs (named):', nonUuidIds.size, ':', [...nonUuidIds].join(', '));
console.log('DB quiz IDs:', dbQuizIds.size);
console.log('');
console.log('JSON quiz IDs already in DB:', alreadyInDb.length);
console.log('JSON quiz IDs NOT yet in DB (new):', notInDb.length);
console.log('DB quiz IDs not in JSON (extra/different):', inDbButNotInJson.length);
console.log('');
console.log('=== IDs in JSON already in DB ===');
alreadyInDb.sort().forEach(id => console.log('  EXISTS:', id));
console.log('');
console.log('=== DB quiz IDs NOT in JSON (DB-only) ===');
inDbButNotInJson.sort().forEach(id => console.log('  DB_ONLY:', id));
