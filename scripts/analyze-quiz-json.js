const fs = require('fs');
const data = JSON.parse(fs.readFileSync('public/quizzes_production_complete 1.json', 'utf8'));

let allQuizIds = new Set();
let totalQuestions = 0;
let quizIdToInfo = {};
let nullQuizCount = 0;
let componentSummary = [];

data.forEach(comp => {
  let enablerSummary = [];
  comp.enablers.forEach(en => {
    const diffs = Object.keys(en.quizzes || {});
    let diffDetails = [];
    diffs.forEach(d => {
      const q = en.quizzes[d];
      if (q === null || q === undefined) {
        nullQuizCount++;
        diffDetails.push({ diff: d, quizId: 'NULL', questions: 0, quizTitle: 'N/A' });
        return;
      }
      const qCount = (q.questions || []).length;
      if (q.quizId) {
        allQuizIds.add(q.quizId);
        if (!quizIdToInfo[q.quizId]) {
          quizIdToInfo[q.quizId] = { title: q.quizTitle, questions: qCount };
        }
      } else {
        nullQuizCount++;
      }
      totalQuestions += qCount;
      diffDetails.push({ diff: d, quizId: q.quizId || 'NULL', questions: qCount, quizTitle: q.quizTitle || 'N/A' });
    });
    enablerSummary.push({
      enablerID: en.enablerID,
      enablerTitle: en.enablerTitle,
      enablerOrder: en.enablerOrder,
      diffs: diffDetails
    });
  });
  componentSummary.push({
    num: comp.componentNumber,
    code: comp.componentCode,
    title: comp.componentTitle,
    enablers: enablerSummary
  });
});

console.log('=== TOTALS ===');
console.log('Total components: ' + data.length);
console.log('Total unique quizIds: ' + allQuizIds.size);
console.log('Total questions across all quizzes: ' + totalQuestions);
console.log('Null/missing quizId entries: ' + nullQuizCount);

console.log('\n=== ALL UNIQUE QUIZ IDs (sorted) ===');
const sortedIds = [...allQuizIds].sort();
sortedIds.forEach(id => {
  const info = quizIdToInfo[id];
  console.log(id + ' | ' + info.questions + 'q | ' + info.title);
});

console.log('\n=== COMPONENT BREAKDOWN ===');
componentSummary.forEach(c => {
  console.log('\nComponent ' + c.num + ' | ' + c.code + ' | ' + c.title);
  c.enablers.forEach(e => {
    console.log('  [order=' + e.enablerOrder + '] enablerID=' + e.enablerID);
    console.log('  enablerTitle: ' + e.enablerTitle);
    e.diffs.forEach(d => {
      console.log('    ' + d.diff + ': quizId=' + d.quizId + ' | ' + d.questions + 'q | ' + d.quizTitle);
    });
  });
});
