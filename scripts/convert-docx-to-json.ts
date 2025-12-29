/**
 * DOCX to JSON Quiz Converter - PERFECT VERSION
 * 
 * Properly extracts topic and question text from German quiz DOCX files.
 * Format: "Thema: TopicWords QuestionText"
 * Topic ends when a German sentence-starting word appears.
 */

import * as fs from 'fs';
import * as path from 'path';
import mammoth from 'mammoth';

// Types matching the database schema
interface QuizOption {
    letter: string;
    text: string;
    isCorrect: boolean;
}

interface QuizExplanation {
    whyCorrect: string;
    whyIncorrect: string;
    keyInsight: string;
}

interface QuizQuestion {
    questionNumber: number;
    topic: string;
    questionText: string;
    options: QuizOption[];
    correctAnswer: string;
    explanation: QuizExplanation;
}

interface EnablerQuiz {
    sourceFile: string;
    questions: QuizQuestion[];
}

interface EnablerData {
    enablerName: string;
    enablerCode: string;
    folderName: string;
    quizzes: {
        LOW?: EnablerQuiz;
        MEDIUM?: EnablerQuiz;
        HIGH?: EnablerQuiz;
    };
}

interface CourseData {
    courseName: string;
    folderName: string;
    parsedAt: string;
    totalEnablers: number;
    totalQuestions: number;
    enablers: EnablerData[];
}

// Configuration
const LOCAL_QUIZ_PATH = path.join(__dirname, '..', 'Local Quiz');
const OUTPUT_PATH = path.join(__dirname, '..', 'quiz_data');

// Difficulty mapping
const DIFFICULTY_MAP: Record<string, 'LOW' | 'MEDIUM' | 'HIGH'> = {
    'light': 'LOW',
    'easy': 'LOW',
    'einfach': 'LOW',
    'medium': 'MEDIUM',
    'mittel': 'MEDIUM',
    'hard': 'HIGH',
    'schwer': 'HIGH',
};

// German words that typically START a question or sentence
// These indicate where the topic ends and the question begins
const SENTENCE_STARTERS = [
    // Question words (Fragewörter)
    'Was', 'Wie', 'Welche', 'Welcher', 'Welches', 'Welchen', 'Welchem',
    'Wer', 'Wem', 'Wen', 'Wessen',
    'Wann', 'Wo', 'Woher', 'Wohin', 'Wozu', 'Worin', 'Womit', 'Wodurch', 'Wofür',
    'Warum', 'Weshalb', 'Wieso',
    // Prepositions starting sentences
    'Aus', 'An', 'Auf', 'Bei', 'Mit', 'Nach', 'Zu', 'Für', 'In', 'Im', 'Unter', 'Über',
    // Articles and determiners starting sentences
    'Ein', 'Eine', 'Einem', 'Einen', 'Einer', 'Eines',
    'Der', 'Die', 'Das', 'Den', 'Dem', 'Des',
    // Verbs that can start questions/statements
    'Ist', 'Sind', 'Hat', 'Haben', 'Kann', 'Können', 'Darf', 'Dürfen',
    'Muss', 'Müssen', 'Soll', 'Sollen', 'Wird', 'Werden', 'Gilt',
    // Other common starters
    'Laut', 'Gemäß', 'Nennen', 'Erklären', 'Beschreiben', 'Definieren',
];

function getDifficultyFromFilename(filename: string): 'LOW' | 'MEDIUM' | 'HIGH' | null {
    const lowerName = filename.toLowerCase();
    for (const [key, value] of Object.entries(DIFFICULTY_MAP)) {
        if (lowerName.includes(key)) {
            return value;
        }
    }
    return null;
}

function extractEnablerCode(text: string): string {
    const match = text.match(/FR-\d+/i);
    return match ? match[0].toUpperCase() : '';
}

async function parseDocxFile(filePath: string): Promise<QuizQuestion[]> {
    console.log(`  Parsing: ${path.basename(filePath)}`);
    const questions: QuizQuestion[] = [];

    try {
        const fileBuffer = fs.readFileSync(filePath);
        const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
        const rawText = textResult.value;

        // Split by question markers
        const questionBlocks = splitIntoQuestionBlocks(rawText);

        for (const block of questionBlocks) {
            const question = parseQuestionBlock(block);
            if (question) {
                questions.push(question);
            }
        }
    } catch (error) {
        console.error(`  Error parsing ${filePath}:`, error);
    }

    return questions;
}

function splitIntoQuestionBlocks(rawText: string): string[] {
    const pattern = /(?=Frage\s*\[?\d+\]?\s*[-–])/gi;
    const blocks = rawText.split(pattern).filter(block => {
        return /^Frage\s*\[?\d+\]?\s*[-–]/i.test(block.trim());
    });
    return blocks;
}

/**
 * PERFECT topic/question extraction
 * Format: "Thema: TopicWords QuestionStartingWord..."
 * Handles multi-word topics like "Beendigung der Berufsausbildung"
 */
function extractTopicAndQuestion(afterThema: string): { topic: string; questionText: string } {
    const words = afterThema.trim().split(/\s+/);

    // Articles that can appear in multi-word topic phrases
    const TOPIC_ARTICLES = ['der', 'die', 'das', 'des', 'dem', 'den'];

    // Words that DEFINITELY start a question (not part of topic)
    const DEFINITE_QUESTION_STARTERS = [
        'Was', 'Wie', 'Welche', 'Welcher', 'Welches', 'Welchen', 'Welchem',
        'Wer', 'Wem', 'Wen', 'Wessen',
        'Wann', 'Wo', 'Woher', 'Wohin', 'Wozu', 'Worin', 'Womit', 'Wodurch', 'Wofür',
        'Warum', 'Weshalb', 'Wieso',
        'Ist', 'Sind', 'Hat', 'Haben', 'Kann', 'Können', 'Darf', 'Dürfen',
        'Muss', 'Müssen', 'Soll', 'Sollen', 'Wird', 'Werden', 'Gilt',
        'Laut', 'Gemäß', 'Nennen', 'Erklären', 'Beschreiben', 'Definieren',
    ];

    // Find the split point between topic and question
    let splitIndex = -1;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const cleanWord = word.replace(/[^\w\u00C0-\u017F-]/g, '');

        // Check if this is definitely a question starter
        if (DEFINITE_QUESTION_STARTERS.some(starter =>
            cleanWord.toLowerCase() === starter.toLowerCase()
        )) {
            splitIndex = i;
            break;
        }

        // Check for articles only if we're past the first word
        // Articles at position 0-2 might be part of a topic phrase like "Beendigung der Berufsausbildung"
        if (i > 2) {
            const isArticle = TOPIC_ARTICLES.some(art => cleanWord.toLowerCase() === art);
            if (isArticle) {
                // Look at the next word - if it starts a question, split here
                // Otherwise, include article in topic
                if (i + 1 < words.length) {
                    const nextWord = words[i + 1].replace(/[^\w\u00C0-\u017F-]/g, '');
                    if (DEFINITE_QUESTION_STARTERS.some(starter =>
                        nextWord.toLowerCase() === starter.toLowerCase()
                    )) {
                        splitIndex = i;
                        break;
                    }
                }
            }
        }

        // Check for Ein/Eine as question starters (only if they're not part of short topic)
        if (i > 1 && ['Ein', 'Eine', 'Einem', 'Einen', 'Einer', 'Eines'].some(s => cleanWord === s)) {
            splitIndex = i;
            break;
        }

        // Prepositions that start questions
        if (i > 1 && ['Aus', 'An', 'Auf', 'Bei', 'Mit', 'Nach', 'Zu', 'Für', 'In', 'Im', 'Unter', 'Über'].some(s => cleanWord === s)) {
            splitIndex = i;
            break;
        }

        // If word ends with '?' it's definitely in the question
        if (word.includes('?')) {
            splitIndex = i;
            break;
        }
    }

    if (splitIndex > 0) {
        const topic = words.slice(0, splitIndex).join(' ').trim();
        const questionText = words.slice(splitIndex).join(' ').trim();
        return { topic, questionText };
    } else if (splitIndex === 0) {
        return { topic: '', questionText: afterThema.trim() };
    } else {
        // No clear split - use heuristic based on length
        const topicLength = Math.min(3, Math.max(1, Math.floor(words.length / 4)));
        const topic = words.slice(0, topicLength).join(' ').trim();
        const questionText = words.slice(topicLength).join(' ').trim();
        return { topic, questionText };
    }
}


function parseQuestionBlock(block: string): QuizQuestion | null {
    try {
        // Extract question number
        const questionNumMatch = block.match(/Frage\s*\[?(\d+)\]?/i);
        if (!questionNumMatch) return null;
        const questionNumber = parseInt(questionNumMatch[1]);

        // Extract content after "Thema:"
        let topic = '';
        let questionText = '';

        const themaMatch = block.match(/Thema:\s*(.+?)(?=\n\s*[A-D]\s*[\)\.:])/is);
        if (themaMatch) {
            const afterThema = themaMatch[1].trim();
            const extracted = extractTopicAndQuestion(afterThema);
            topic = extracted.topic;
            questionText = extracted.questionText;
        }

        // Fallback if Thema pattern doesn't match
        if (!questionText) {
            const altMatch = block.match(/Frage\s*\[?\d+\]?[^\n]*\n+(.+?)(?=\n\s*[A-D]\s*[\)\.:])/is);
            if (altMatch) {
                let text = altMatch[1].trim();
                // Remove metadata if present
                text = text.replace(/\[Schwierigkeit:[^\]]*\]\s*/gi, '');
                text = text.replace(/Thema:\s*/gi, '');
                questionText = text.trim();
            }
        }

        // Extract options
        const options = extractOptions(block);
        if (options.length < 2) {
            console.log(`    Warning: Question ${questionNumber} has only ${options.length} options`);
            return null;
        }

        // Detect and mark correct answer
        const correctAnswer = detectCorrectAnswer(block);
        for (const option of options) {
            option.isCorrect = option.letter === correctAnswer;
        }

        // Extract explanation
        const explanation = extractExplanation(block);

        return {
            questionNumber,
            topic,
            questionText: questionText || `Frage ${questionNumber}`,
            options,
            correctAnswer,
            explanation,
        };

    } catch (error) {
        console.error('Error parsing question block:', error);
        return null;
    }
}

function extractOptions(block: string): QuizOption[] {
    // Get section before explanation
    const optionsSection = block.split(/Richtige Antwort/i)[0];

    const lines = optionsSection.split('\n');
    const optionMap = new Map<string, string>();

    let currentLetter = '';
    let currentText = '';

    for (const line of lines) {
        const trimmed = line.trim();

        // Match option pattern: A) text or A. text or A text
        const optionMatch = trimmed.match(/^([A-D])\s*[\)\.:\s]\s*(.*)$/i);

        if (optionMatch) {
            // Save previous option
            if (currentLetter && currentText) {
                const clean = cleanOptionText(currentText);
                if (isValidOption(clean)) {
                    // Keep shorter version if duplicate (more likely the actual answer)
                    if (!optionMap.has(currentLetter) || clean.length < optionMap.get(currentLetter)!.length) {
                        optionMap.set(currentLetter, clean);
                    }
                }
            }

            currentLetter = optionMatch[1].toLowerCase();
            currentText = optionMatch[2];
        } else if (currentLetter && trimmed && !trimmed.match(/^Richtige|^Warum|^Wichtige/i)) {
            // Continuation of current option
            currentText += ' ' + trimmed;
        }
    }

    // Don't forget last option
    if (currentLetter && currentText) {
        const clean = cleanOptionText(currentText);
        if (isValidOption(clean)) {
            if (!optionMap.has(currentLetter) || clean.length < optionMap.get(currentLetter)!.length) {
                optionMap.set(currentLetter, clean);
            }
        }
    }

    // Convert to sorted array
    const options: QuizOption[] = [];
    for (const letter of ['a', 'b', 'c', 'd']) {
        if (optionMap.has(letter)) {
            options.push({
                letter,
                text: optionMap.get(letter)!,
                isCorrect: false
            });
        }
    }

    return options;
}

function cleanOptionText(text: string): string {
    return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function isValidOption(text: string): boolean {
    if (!text || text.length < 2) return false;
    if (text.includes('Thema:')) return false;
    if (text.includes('Schwierigkeit:')) return false;
    if (text.includes('[Schwierigkeit')) return false;
    if (text.match(/^Frage\s*\[?\d/i)) return false;
    if (text.length > 200 && text.includes('?')) return false;
    if (text.includes('korrekt ist')) return false;
    if (text.includes('inkorrekt sind')) return false;
    return true;
}

function detectCorrectAnswer(block: string): string {
    // Primary: "Richtige Antwort: X"
    const explicitMatch = block.match(/Richtige Antwort:\s*([A-D])/i);
    if (explicitMatch) {
        return explicitMatch[1].toLowerCase();
    }

    // Secondary: "Warum X korrekt ist"
    const explanationMatch = block.match(/Warum\s+([A-D])\s+korrekt ist/i);
    if (explanationMatch) {
        return explanationMatch[1].toLowerCase();
    }

    console.log(`    Warning: Could not detect correct answer`);
    return '';
}

function extractExplanation(block: string): QuizExplanation {
    const explanation: QuizExplanation = {
        whyCorrect: '',
        whyIncorrect: '',
        keyInsight: '',
    };

    const whyCorrectMatch = block.match(/Warum\s+[A-D]?\s*korrekt ist:?\s*(.+?)(?=Warum\s+falsche|Wichtige\s+Erkenntnis|$)/is);
    if (whyCorrectMatch) {
        explanation.whyCorrect = cleanExplanationText(whyCorrectMatch[1]);
    }

    const whyIncorrectMatch = block.match(/Warum\s+falsche\s+Antworten\s+inkorrekt\s+sind:?\s*(.+?)(?=Wichtige\s+Erkenntnis|Frage\s*\[?\d|$)/is);
    if (whyIncorrectMatch) {
        explanation.whyIncorrect = cleanExplanationText(whyIncorrectMatch[1]);
    }

    const keyInsightMatch = block.match(/Wichtige\s+Erkenntnis:?\s*(.+?)(?=Frage\s*\[?\d|$)/is);
    if (keyInsightMatch) {
        explanation.keyInsight = cleanExplanationText(keyInsightMatch[1]);
    }

    return explanation;
}

function cleanExplanationText(text: string): string {
    return text
        .replace(/^\s*•\s*/gm, '')
        .replace(/\n\s*\n/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function processCourseFolder(courseFolderPath: string): Promise<CourseData> {
    const courseName = path.basename(courseFolderPath);
    console.log(`\nProcessing course: ${courseName}`);

    const courseData: CourseData = {
        courseName,
        folderName: courseName,
        parsedAt: new Date().toISOString(),
        totalEnablers: 0,
        totalQuestions: 0,
        enablers: [],
    };

    const entries = fs.readdirSync(courseFolderPath, { withFileTypes: true });
    const enablerFolders = entries.filter(e => e.isDirectory).map(e => e.name).sort();

    for (const enablerFolder of enablerFolders) {
        const enablerPath = path.join(courseFolderPath, enablerFolder);
        console.log(`  Enabler: ${enablerFolder}`);

        const enablerData: EnablerData = {
            enablerName: enablerFolder,
            enablerCode: '',
            folderName: enablerFolder,
            quizzes: {},
        };

        // Skip temporary files (starting with ~)
        const files = fs.readdirSync(enablerPath).filter(f =>
            f.endsWith('.docx') && !f.startsWith('~')
        );

        for (const file of files) {
            const filePath = path.join(enablerPath, file);
            const difficulty = getDifficultyFromFilename(file);

            if (!difficulty) {
                console.log(`    Skipping ${file} - unknown difficulty`);
                continue;
            }

            const questions = await parseDocxFile(filePath);

            // Extract enabler code
            if (questions.length > 0 && !enablerData.enablerCode) {
                const fileContent = fs.readFileSync(filePath);
                const textResult = await mammoth.extractRawText({ buffer: fileContent });
                enablerData.enablerCode = extractEnablerCode(textResult.value);
            }

            enablerData.quizzes[difficulty] = {
                sourceFile: file,
                questions,
            };

            courseData.totalQuestions += questions.length;
            console.log(`    ${difficulty}: ${questions.length} questions`);
        }

        courseData.enablers.push(enablerData);
        courseData.totalEnablers++;
    }

    return courseData;
}

function sanitizeFilename(name: string): string {
    return name
        .toLowerCase()
        .replace(/[§()]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^\w\-]/g, '')
        .replace(/_+/g, '_')
        .substring(0, 50);
}

async function main() {
    const args = process.argv.slice(2);
    const singleCourse = args[0];

    if (!fs.existsSync(OUTPUT_PATH)) {
        fs.mkdirSync(OUTPUT_PATH, { recursive: true });
    }

    const entries = fs.readdirSync(LOCAL_QUIZ_PATH, { withFileTypes: true });
    let courseFolders = entries.filter(e => e.isDirectory).map(e => e.name).sort();

    if (singleCourse) {
        courseFolders = courseFolders.filter(f =>
            f.toLowerCase().includes(singleCourse.toLowerCase())
        );
        console.log(`Processing only courses matching: "${singleCourse}"`);
    }

    console.log(`Found ${courseFolders.length} course folders`);
    console.log(`Output directory: ${OUTPUT_PATH}`);

    const results: { course: string; file: string; questions: number; enablers: number }[] = [];

    for (const courseFolder of courseFolders) {
        const coursePath = path.join(LOCAL_QUIZ_PATH, courseFolder);
        const courseData = await processCourseFolder(coursePath);

        const outputFilename = sanitizeFilename(courseFolder) + '.json';
        const outputPath = path.join(OUTPUT_PATH, outputFilename);

        fs.writeFileSync(outputPath, JSON.stringify(courseData, null, 2), 'utf-8');

        results.push({
            course: courseFolder,
            file: outputFilename,
            questions: courseData.totalQuestions,
            enablers: courseData.totalEnablers,
        });

        console.log(`  Wrote: ${outputFilename}`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    let totalQuestions = 0;
    let totalEnablers = 0;

    for (const r of results) {
        console.log(`${r.file}: ${r.enablers} enablers, ${r.questions} questions`);
        totalQuestions += r.questions;
        totalEnablers += r.enablers;
    }

    console.log('-'.repeat(60));
    console.log(`TOTAL: ${results.length} courses, ${totalEnablers} enablers, ${totalQuestions} questions`);

    // Write status file
    const statusFile = path.join(OUTPUT_PATH, '_import_status.json');
    fs.writeFileSync(statusFile, JSON.stringify({
        generatedAt: new Date().toISOString(),
        courses: results,
        totals: {
            courses: results.length,
            enablers: totalEnablers,
            questions: totalQuestions,
        },
    }, null, 2), 'utf-8');
}

main().catch(console.error);
