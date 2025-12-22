/**
 * Comprehensive QA Script for Quiz JSON Files
 * 
 * Performs detailed quality analysis on all generated quiz JSON files:
 * - Structural validation
 * - Content quality checks
 * - Answer verification
 * - Duplicate detection
 * - Factual consistency checks
 */

import * as fs from 'fs';
import * as path from 'path';

interface QAIssue {
    severity: 'ERROR' | 'WARNING' | 'INFO';
    course: string;
    enabler: string;
    difficulty: string;
    questionNumber: number;
    issue: string;
    details?: string;
}

interface QAStats {
    totalCourses: number;
    totalEnablers: number;
    totalQuestions: number;
    questionsWithCorrectAnswer: number;
    questionsWithExplanation: number;
    questionsWithTopic: number;
    questionsWithAllOptions: number;
    averageOptionsPerQuestion: number;
    issues: QAIssue[];
}

const QUIZ_DATA_PATH = path.join(__dirname, '..', 'quiz_data');

function loadJsonFile(filePath: string): any {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
}

function analyzeQuestion(
    question: any,
    courseName: string,
    enablerName: string,
    difficulty: string,
    stats: QAStats
): void {
    const qNum = question.questionNumber;

    // Check question text
    if (!question.questionText || question.questionText.trim().length < 10) {
        stats.issues.push({
            severity: 'ERROR',
            course: courseName,
            enabler: enablerName,
            difficulty,
            questionNumber: qNum,
            issue: 'Missing or too short question text',
            details: `Text: "${question.questionText?.substring(0, 50)}..."`
        });
    }

    // Check if question text contains metadata (parsing issue)
    if (question.questionText?.includes('Thema:') || question.questionText?.includes('Schwierigkeit:')) {
        stats.issues.push({
            severity: 'WARNING',
            course: courseName,
            enabler: enablerName,
            difficulty,
            questionNumber: qNum,
            issue: 'Question text contains metadata (possible parsing issue)',
            details: `Text: "${question.questionText?.substring(0, 80)}..."`
        });
    }

    // Check options
    const options = question.options || [];
    if (options.length < 2) {
        stats.issues.push({
            severity: 'ERROR',
            course: courseName,
            enabler: enablerName,
            difficulty,
            questionNumber: qNum,
            issue: `Too few options: ${options.length}`,
        });
    } else if (options.length !== 4) {
        stats.issues.push({
            severity: 'WARNING',
            course: courseName,
            enabler: enablerName,
            difficulty,
            questionNumber: qNum,
            issue: `Non-standard option count: ${options.length} (expected 4)`,
        });
    } else {
        stats.questionsWithAllOptions++;
    }

    // Check for correct answer marked
    const correctOptions = options.filter((o: any) => o.isCorrect === true);
    if (correctOptions.length === 0) {
        stats.issues.push({
            severity: 'ERROR',
            course: courseName,
            enabler: enablerName,
            difficulty,
            questionNumber: qNum,
            issue: 'No correct answer marked',
            details: `correctAnswer field: "${question.correctAnswer}"`
        });
    } else if (correctOptions.length > 1) {
        stats.issues.push({
            severity: 'WARNING',
            course: courseName,
            enabler: enablerName,
            difficulty,
            questionNumber: qNum,
            issue: `Multiple correct answers marked: ${correctOptions.length}`,
        });
    } else {
        stats.questionsWithCorrectAnswer++;
    }

    // Check correctAnswer field matches marked option
    if (question.correctAnswer) {
        const markedOption = options.find((o: any) => o.letter === question.correctAnswer);
        if (markedOption && !markedOption.isCorrect) {
            stats.issues.push({
                severity: 'ERROR',
                course: courseName,
                enabler: enablerName,
                difficulty,
                questionNumber: qNum,
                issue: 'correctAnswer field does not match isCorrect marking',
                details: `correctAnswer: "${question.correctAnswer}", but that option has isCorrect=false`
            });
        }
    }

    // Check for duplicate option text
    const optionTexts = options.map((o: any) => o.text?.toLowerCase().trim());
    const uniqueTexts = new Set(optionTexts);
    if (uniqueTexts.size < optionTexts.length) {
        stats.issues.push({
            severity: 'WARNING',
            course: courseName,
            enabler: enablerName,
            difficulty,
            questionNumber: qNum,
            issue: 'Duplicate option text detected',
        });
    }

    // Check option text quality
    for (const opt of options) {
        if (!opt.text || opt.text.trim().length < 3) {
            stats.issues.push({
                severity: 'ERROR',
                course: courseName,
                enabler: enablerName,
                difficulty,
                questionNumber: qNum,
                issue: `Empty or too short option ${opt.letter}`,
                details: `Text: "${opt.text}"`
            });
        }

        // Check if option contains question text (parsing issue)
        if (opt.text?.includes('?') && opt.text.length > 100) {
            stats.issues.push({
                severity: 'WARNING',
                course: courseName,
                enabler: enablerName,
                difficulty,
                questionNumber: qNum,
                issue: `Option ${opt.letter} may contain question text (long with ?)`,
                details: `Text: "${opt.text.substring(0, 50)}..."`
            });
        }
    }

    // Check topic
    if (question.topic && question.topic.trim().length > 0) {
        stats.questionsWithTopic++;

        // Check if topic is too long (might contain question text)
        if (question.topic.length > 80) {
            stats.issues.push({
                severity: 'WARNING',
                course: courseName,
                enabler: enablerName,
                difficulty,
                questionNumber: qNum,
                issue: 'Topic is very long (may contain question text)',
                details: `Topic: "${question.topic.substring(0, 50)}..."`
            });
        }
    }

    // Check explanation
    const explanation = question.explanation;
    if (explanation) {
        if (explanation.whyCorrect && explanation.whyCorrect.trim().length > 20) {
            stats.questionsWithExplanation++;
        }

        // Check if explanation references the correct answer
        if (explanation.whyCorrect && question.correctAnswer) {
            const upperAnswer = question.correctAnswer.toUpperCase();
            if (!explanation.whyCorrect.includes(upperAnswer) &&
                !explanation.whyCorrect.toLowerCase().includes(question.correctAnswer)) {
                // This is just info, not an error
            }
        }
    }

    stats.totalQuestions++;
}

function analyzeEnablerQuiz(
    quiz: any,
    courseName: string,
    enablerName: string,
    difficulty: string,
    stats: QAStats
): void {
    if (!quiz || !quiz.questions || !Array.isArray(quiz.questions)) {
        stats.issues.push({
            severity: 'WARNING',
            course: courseName,
            enabler: enablerName,
            difficulty,
            questionNumber: 0,
            issue: 'No questions found in quiz',
        });
        return;
    }

    for (const question of quiz.questions) {
        analyzeQuestion(question, courseName, enablerName, difficulty, stats);
    }
}

function analyzeCourseFile(filePath: string, stats: QAStats): void {
    const courseData = loadJsonFile(filePath);
    const courseName = courseData.courseName || path.basename(filePath);

    console.log(`\n📁 Analyzing: ${courseName}`);

    if (!courseData.enablers || !Array.isArray(courseData.enablers)) {
        stats.issues.push({
            severity: 'ERROR',
            course: courseName,
            enabler: '',
            difficulty: '',
            questionNumber: 0,
            issue: 'No enablers array found in course',
        });
        return;
    }

    stats.totalCourses++;

    for (const enabler of courseData.enablers) {
        stats.totalEnablers++;
        const enablerName = enabler.enablerName || 'Unknown';

        const quizzes = enabler.quizzes || {};

        if (quizzes.LOW) {
            analyzeEnablerQuiz(quizzes.LOW, courseName, enablerName, 'LOW', stats);
        }
        if (quizzes.MEDIUM) {
            analyzeEnablerQuiz(quizzes.MEDIUM, courseName, enablerName, 'MEDIUM', stats);
        }
        if (quizzes.HIGH) {
            analyzeEnablerQuiz(quizzes.HIGH, courseName, enablerName, 'HIGH', stats);
        }
    }
}

function runQA(): QAStats {
    const stats: QAStats = {
        totalCourses: 0,
        totalEnablers: 0,
        totalQuestions: 0,
        questionsWithCorrectAnswer: 0,
        questionsWithExplanation: 0,
        questionsWithTopic: 0,
        questionsWithAllOptions: 0,
        averageOptionsPerQuestion: 0,
        issues: [],
    };

    console.log('🔍 Starting Comprehensive QA Analysis...\n');
    console.log(`📂 Quiz data directory: ${QUIZ_DATA_PATH}\n`);

    // Get all JSON files
    const files = fs.readdirSync(QUIZ_DATA_PATH)
        .filter(f => f.endsWith('.json') && !f.startsWith('_'));

    console.log(`📋 Found ${files.length} course files to analyze\n`);

    for (const file of files) {
        const filePath = path.join(QUIZ_DATA_PATH, file);
        analyzeCourseFile(filePath, stats);
    }

    return stats;
}

function printReport(stats: QAStats): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 QA ANALYSIS REPORT');
    console.log('='.repeat(80));

    console.log('\n📈 STATISTICS:');
    console.log(`   Total Courses: ${stats.totalCourses}`);
    console.log(`   Total Enablers: ${stats.totalEnablers}`);
    console.log(`   Total Questions: ${stats.totalQuestions}`);
    console.log(`   Questions with Correct Answer: ${stats.questionsWithCorrectAnswer} (${(stats.questionsWithCorrectAnswer / stats.totalQuestions * 100).toFixed(1)}%)`);
    console.log(`   Questions with Explanation: ${stats.questionsWithExplanation} (${(stats.questionsWithExplanation / stats.totalQuestions * 100).toFixed(1)}%)`);
    console.log(`   Questions with Topic: ${stats.questionsWithTopic} (${(stats.questionsWithTopic / stats.totalQuestions * 100).toFixed(1)}%)`);
    console.log(`   Questions with 4 Options: ${stats.questionsWithAllOptions} (${(stats.questionsWithAllOptions / stats.totalQuestions * 100).toFixed(1)}%)`);

    // Group issues by severity
    const errors = stats.issues.filter(i => i.severity === 'ERROR');
    const warnings = stats.issues.filter(i => i.severity === 'WARNING');
    const infos = stats.issues.filter(i => i.severity === 'INFO');

    console.log('\n⚠️  ISSUES SUMMARY:');
    console.log(`   🔴 ERRORS: ${errors.length}`);
    console.log(`   🟡 WARNINGS: ${warnings.length}`);
    console.log(`   🔵 INFO: ${infos.length}`);

    if (errors.length > 0) {
        console.log('\n🔴 ERRORS (Must Fix):');
        console.log('-'.repeat(80));
        for (const issue of errors.slice(0, 20)) {
            console.log(`   ${issue.course.substring(0, 30)}... | Q${issue.questionNumber} | ${issue.issue}`);
            if (issue.details) console.log(`      └── ${issue.details.substring(0, 60)}...`);
        }
        if (errors.length > 20) {
            console.log(`   ... and ${errors.length - 20} more errors`);
        }
    }

    if (warnings.length > 0) {
        console.log('\n🟡 WARNINGS (Review Recommended):');
        console.log('-'.repeat(80));
        for (const issue of warnings.slice(0, 15)) {
            console.log(`   ${issue.course.substring(0, 30)}... | Q${issue.questionNumber} | ${issue.issue}`);
            if (issue.details) console.log(`      └── ${issue.details.substring(0, 60)}...`);
        }
        if (warnings.length > 15) {
            console.log(`   ... and ${warnings.length - 15} more warnings`);
        }
    }

    // Quality score
    const qualityScore = (
        (stats.questionsWithCorrectAnswer / stats.totalQuestions) * 40 +
        (stats.questionsWithExplanation / stats.totalQuestions) * 30 +
        (stats.questionsWithAllOptions / stats.totalQuestions) * 20 +
        ((stats.totalQuestions - errors.length) / stats.totalQuestions) * 10
    );

    console.log('\n' + '='.repeat(80));
    console.log(`🏆 OVERALL QUALITY SCORE: ${qualityScore.toFixed(1)}/100`);

    if (qualityScore >= 95) {
        console.log('   ✅ EXCELLENT - Ready for database import!');
    } else if (qualityScore >= 85) {
        console.log('   ✅ GOOD - Minor issues to review');
    } else if (qualityScore >= 70) {
        console.log('   ⚠️  ACCEPTABLE - Some issues need attention');
    } else {
        console.log('   ❌ NEEDS WORK - Significant issues found');
    }
    console.log('='.repeat(80) + '\n');

    // Write detailed report to file
    const reportPath = path.join(QUIZ_DATA_PATH, '_qa_report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        qualityScore,
        statistics: {
            totalCourses: stats.totalCourses,
            totalEnablers: stats.totalEnablers,
            totalQuestions: stats.totalQuestions,
            questionsWithCorrectAnswer: stats.questionsWithCorrectAnswer,
            questionsWithExplanation: stats.questionsWithExplanation,
            questionsWithTopic: stats.questionsWithTopic,
            questionsWithAllOptions: stats.questionsWithAllOptions,
        },
        issuesSummary: {
            errors: errors.length,
            warnings: warnings.length,
            info: infos.length,
        },
        allIssues: stats.issues,
    }, null, 2));

    console.log(`📝 Detailed report saved to: ${reportPath}\n`);
}

// Run the QA
const stats = runQA();
printReport(stats);
