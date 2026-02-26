const fs = require('fs');

const TRAINER_ID = 'eaa07e4f-6a76-4781-93e0-49dbfc7edb43';
const MISSING_QUIZ_IDS = [
  '544dc945-1109-45b8-a295-2a23cb4579ed',
  '37d31e3a-0528-4801-b946-cb76d8c80a9b'
];

const jsonData = JSON.parse(fs.readFileSync('c:/Users/Yash Bhesaniya/OneDrive - WAMOCON GmbH/Desktop/WMC/Wamocon_FIAE/public/quizzes_production_complete 1.json', 'utf8'));

// Find the missing quiz entries
const missingQuizzes = [];

for (const component of jsonData) {
  for (const enabler of component.enablers) {
    const enablerID = enabler.enablerID;
    const quizzes = enabler.quizzes;

    for (const [difficulty, quizData] of Object.entries(quizzes)) {
      if (!quizData) continue;
      const quizId = quizData.quizId;
      if (MISSING_QUIZ_IDS.includes(quizId)) {
        missingQuizzes.push({
          enablerID,
          difficulty,
          quizId,
          quizTitle: quizData.quizTitle,
          questions: quizData.questions || []
        });
      }
    }
  }
}

console.log('Found missing quizzes:', missingQuizzes.length);
missingQuizzes.forEach(q => {
  console.log(`  ID: ${q.quizId}`);
  console.log(`  Title: ${q.quizTitle}`);
  console.log(`  EnablerID: ${q.enablerID}`);
  console.log(`  Difficulty: ${q.difficulty}`);
  console.log(`  Questions: ${q.questions.length}`);
  console.log('');
});

// Helper to escape SQL strings
function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

// Generate SQL as an array of complete statements (not line-by-line)
const sqlStatements = [];

for (const quiz of missingQuizzes) {
  // Step 2a: Insert quiz
  sqlStatements.push(
    `INSERT INTO quizzes (id, title, quiz_type, created_by_id, is_active) VALUES (${escapeSql(quiz.quizId)}, ${escapeSql(quiz.quizTitle)}, 'LESSON', ${escapeSql(TRAINER_ID)}, true) ON CONFLICT (id) DO NOTHING;`
  );

  // Step 2b & 2c: Insert questions and options using CTEs
  for (let qIdx = 0; qIdx < quiz.questions.length; qIdx++) {
    const question = quiz.questions[qIdx];
    const questionText = question.questionText || question.question_text || '';
    const questionType = question.questionType || question.question_type || 'MCQ';
    const expectedAnswer = question.expectedAnswer || question.expected_answer || null;
    const questionOrder = question.questionOrder || question.order_index || (qIdx + 1);
    const options = question.options || [];

    if (options.length > 0) {
      // Build option rows for UNION ALL
      const optionSelects = options.map((opt) => {
        const optText = opt.optionText || opt.option_text || '';
        const isCorrect = opt.isCorrect || opt.is_correct || false;
        const explanation = opt.explanation || null;
        return `SELECT (SELECT id FROM inserted_question_${qIdx}), ${escapeSql(optText)}, ${isCorrect}, ${explanation ? escapeSql(explanation) : 'NULL'}`;
      });

      const stmt = `WITH inserted_question_${qIdx} AS (INSERT INTO questions (quiz_id, question_text, question_type, expected_answer, order_index) VALUES (${escapeSql(quiz.quizId)}, ${escapeSql(questionText)}, ${escapeSql(questionType)}, ${expectedAnswer ? escapeSql(expectedAnswer) : 'NULL'}, ${questionOrder}) ON CONFLICT DO NOTHING RETURNING id) INSERT INTO options (question_id, option_text, is_correct, explanation) ${optionSelects.join(' UNION ALL ')};`;

      sqlStatements.push(stmt);
    } else {
      // No options (TEXT type question)
      sqlStatements.push(
        `INSERT INTO questions (quiz_id, question_text, question_type, expected_answer, order_index) VALUES (${escapeSql(quiz.quizId)}, ${escapeSql(questionText)}, ${escapeSql(questionType)}, ${expectedAnswer ? escapeSql(expectedAnswer) : 'NULL'}, ${questionOrder}) ON CONFLICT DO NOTHING;`
      );
    }
  }

  // Step 2d: Insert enabler_quiz_link
  sqlStatements.push(
    `INSERT INTO enabler_quiz_links (enabler_id, quiz_id, difficulty) VALUES (${escapeSql(quiz.enablerID)}, ${escapeSql(quiz.quizId)}, ${escapeSql(quiz.difficulty)}) ON CONFLICT DO NOTHING;`
  );
}

const sqlOutput = sqlStatements.join('\n');
fs.writeFileSync('c:/Users/Yash Bhesaniya/OneDrive - WAMOCON GmbH/Desktop/WMC/Wamocon_FIAE/scripts/phase2-insert.sql', sqlOutput);
console.log('SQL written to phase2-insert.sql');
console.log('Total SQL statements:', sqlStatements.length);
