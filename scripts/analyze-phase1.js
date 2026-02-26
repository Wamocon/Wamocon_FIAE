const fs = require('fs');

// Load JSON data
const jsonData = JSON.parse(fs.readFileSync('c:/Users/Yash Bhesaniya/OneDrive - WAMOCON GmbH/Desktop/WMC/Wamocon_FIAE/public/quizzes_production_complete 1.json', 'utf8'));

// Load DB links
const dbLinksRaw = fs.readFileSync('c:/Users/Yash Bhesaniya/OneDrive - WAMOCON GmbH/Desktop/WMC/Wamocon_FIAE/scripts/db_links.csv', 'utf8');
const dbLinks = new Map(); // key: "enablerID|difficulty" => quizId
const dbLinkSet = new Set(); // key: "enablerID|quizId|difficulty"

for (const line of dbLinksRaw.split('\n').filter(l => l.trim())) {
  const parts = line.trim().split(',');
  if (parts.length >= 3) {
    const [enablerID, quizId, difficulty] = parts;
    dbLinks.set(`${enablerID}|${difficulty}`, quizId);
    dbLinkSet.add(`${enablerID}|${quizId}|${difficulty}`);
  }
}

// Load DB quizzes
const dbQuizzesRaw = fs.readFileSync('c:/Users/Yash Bhesaniya/OneDrive - WAMOCON GmbH/Desktop/WMC/Wamocon_FIAE/scripts/db_quizzes.txt', 'utf8');
const dbQuizIds = new Set();
const dbQuizTitles = new Map(); // id => title

for (const line of dbQuizzesRaw.split('\n').filter(l => l.trim())) {
  const pipeIdx = line.indexOf('|');
  if (pipeIdx > 0) {
    const id = line.substring(0, pipeIdx).trim();
    const title = line.substring(pipeIdx + 1).trim();
    dbQuizIds.add(id);
    dbQuizTitles.set(id, title);
  }
}

// Extract valid triples from JSON
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validTriples = [];
const skippedEntries = [];

for (const component of jsonData) {
  for (const enabler of component.enablers) {
    const enablerID = enabler.enablerID;
    const quizzes = enabler.quizzes;

    for (const [difficulty, quizData] of Object.entries(quizzes)) {
      if (!quizData) {
        skippedEntries.push({ enablerID, difficulty, quizId: null, reason: 'null-quiz-data' });
        continue;
      }

      const quizId = quizData.quizId;

      if (!quizId || quizId === '-' || !UUID_REGEX.test(quizId)) {
        skippedEntries.push({ enablerID, difficulty, quizId, reason: quizId === '-' ? 'dash' : 'non-UUID' });
      } else {
        validTriples.push({
          enablerID,
          quizId,
          difficulty,
          quizTitle: quizData.quizTitle,
          questions: quizData.questions
        });
      }
    }
  }
}

console.log('=== PHASE 1 ANALYSIS ===');
console.log('Valid triples from JSON:', validTriples.length);
console.log('DB links count:', dbLinks.size);
console.log('DB quiz IDs count:', dbQuizIds.size);
console.log('');

const groupA = []; // triple exists in DB
const groupB = []; // quiz exists in DB but link missing
const groupC = []; // same (enablerID, difficulty) with different quizId
const groupD = []; // quizId does not exist in DB at all

for (const triple of validTriples) {
  const { enablerID, quizId, difficulty, quizTitle } = triple;
  const tripleKey = `${enablerID}|${quizId}|${difficulty}`;
  const linkKey = `${enablerID}|${difficulty}`;

  if (dbLinkSet.has(tripleKey)) {
    // Group A: exact triple exists
    groupA.push(triple);
  } else if (!dbQuizIds.has(quizId)) {
    // Group D: quizId doesn't exist in DB
    groupD.push(triple);
  } else {
    // quizId exists in DB but link triple is missing
    const existingQuizId = dbLinks.get(linkKey);

    if (!existingQuizId) {
      // No link at all for this (enablerID, difficulty) -> Group B
      groupB.push(triple);
    } else if (existingQuizId === quizId) {
      // Shouldn't happen given tripleKey check above, but just in case
      groupA.push(triple);
    } else {
      // Same (enablerID, difficulty) but different quizId -> Group C
      const existingTitle = dbQuizTitles.get(existingQuizId) || 'UNKNOWN';
      groupC.push({
        ...triple,
        existingQuizId,
        existingTitle,
        titlesMatch: existingTitle === quizTitle || existingTitle.trim() === quizTitle.trim()
      });
    }
  }
}

console.log('Group A (already exists - no action):', groupA.length);
console.log('Group B (quiz exists, link missing - INSERT link):', groupB.length);
console.log('Group C (same enablerID+difficulty, different quizId):', groupC.length);
console.log('Group D (quizId not in DB - need to insert quiz):', groupD.length);
console.log('');

if (groupB.length > 0) {
  console.log('=== GROUP B (Insert Links) ===');
  groupB.forEach(t => console.log(`  enablerID=${t.enablerID} quizId=${t.quizId} difficulty=${t.difficulty} title="${t.quizTitle}"`));
  console.log('');
}

if (groupC.length > 0) {
  console.log('=== GROUP C (Different quizId for same enablerID+difficulty) ===');
  groupC.forEach(t => {
    const action = t.titlesMatch ? 'UPDATE (same title)' : 'SKIP (different title)';
    console.log(`  [${action}] enablerID=${t.enablerID} difficulty=${t.difficulty}`);
    console.log(`    JSON quizId=${t.quizId} title="${t.quizTitle}"`);
    console.log(`    DB  quizId=${t.existingQuizId} title="${t.existingTitle}"`);
  });
  console.log('');
}

if (groupD.length > 0) {
  console.log('=== GROUP D (Missing Quizzes) ===');
  groupD.forEach(t => console.log(`  enablerID=${t.enablerID} quizId=${t.quizId} difficulty=${t.difficulty} title="${t.quizTitle}"`));
  console.log('');
}

console.log('=== SKIPPED ENTRIES SUMMARY ===');
const dashCount = skippedEntries.filter(e => e.reason === 'dash').length;
const nonUUIDCount = skippedEntries.filter(e => e.reason === 'non-UUID').length;
const nullCount = skippedEntries.filter(e => e.reason === 'null-quiz-data').length;
console.log(`  Dash ("-"): ${dashCount}`);
console.log(`  Non-UUID: ${nonUUIDCount}`);
console.log(`  Null quiz data: ${nullCount}`);
console.log(`  Total skipped: ${skippedEntries.length}`);

// Save results for use in later phases
const results = { groupA, groupB, groupC, groupD, skippedEntries, validTriples };
fs.writeFileSync('c:/Users/Yash Bhesaniya/OneDrive - WAMOCON GmbH/Desktop/WMC/Wamocon_FIAE/scripts/phase1-results.json', JSON.stringify(results, null, 2));
console.log('\nResults saved to phase1-results.json');
