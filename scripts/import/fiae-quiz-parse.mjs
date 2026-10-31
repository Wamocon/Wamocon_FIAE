// Reads the quiz files of the FIAE Word delivery (06-01-26 LFA\FIAE\Komponenten\...\Quiz\QUIZ_FR-nnn_light|medium|hard.docx).
// The files come in several shapes: "Frage [1] - [Schwierigkeit: Leicht] Thema: ..." with the options in the
// next paragraphs or inline, "Frage: ..." with the right option marked by a check mark, lowercase option
// letters, a line "Richtige Antwort: B Erklärung:" followed by the reasons. A question is only accepted
// when it has a text, at least two options and exactly one clear right answer. Everything else is
// reported, nothing is guessed.

// jszip is loaded when a file is read, so the parser can be tested where the packages are not installed

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = s =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n =
        e[1].toLowerCase() === 'x'
          ? parseInt(e.slice(2), 16)
          : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** The non-empty paragraphs of a .docx in reading order (tables included). */
export async function docxLines(buffer) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml is missing');
  const xml = await entry.async('string');
  const lines = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    let text = '';
    for (const m of p.matchAll(
      /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g
    ))
      text += m[1] !== undefined ? m[1] : ' ';
    text = decode(text).replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  }
  return lines;
}

/** Letters and digits only, lowercase: the same text in two layouts compares equal. */
export const norm = s =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^0-9a-zäöüß]+/g, '');

const START = /^Frage\b\s*(?:\[\s*\d+\s*\]|\d+)?\s*[-–:.]/i;
const OPTION = /^([A-Fa-f])[).]\s+(.*)$/;
const CHECK = /[✅✔☑✓]/;

const cleanOption = text =>
  text
    .replace(/\s*[✅✔☑✓]+\s*/g, ' ')
    .replace(/\s*\[vgl:[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** One block of lines (the first one starts with "Frage") to a question or issues. */
function parseBlock(block, number) {
  const issues = [];
  let head = block[0].replace(START, '').trim();
  head = head.replace(/^\[\s*Schwierigkeit:[^\]]*\]\s*[-–]?\s*/i, '').trim();
  head = head.replace(/^Thema:\s*/i, '').trim();

  const options = []; // { letter, text, marked }
  const stem = [];
  let answer = null;
  let afterAnswer = false;
  const reasons = {};

  // options written inline behind the question text: "... A) x B) y C) z D) w"
  const inline = /\s(A\)\s)/.exec(head);
  if (inline && /\sB\)\s/.test(head)) {
    stem.push(head.slice(0, inline.index).trim());
    for (const piece of head
      .slice(inline.index + 1)
      .split(/\s+(?=[B-F]\)\s)/)) {
      const m = OPTION.exec(piece);
      if (m)
        options.push({
          letter: m[1].toUpperCase(),
          text: cleanOption(m[2]),
          marked: CHECK.test(m[2]),
        });
    }
  } else if (head) stem.push(head);

  for (const line of block.slice(1)) {
    const right = /^Richtige Antwort:?\s*([A-Fa-f])\b/i.exec(line);
    if (right && answer === null) {
      answer = right[1].toUpperCase();
      afterAnswer = true;
      continue;
    }
    if (afterAnswer) {
      const why = /^Warum\s+([A-Fa-f])\s+korrekt ist:?\s*(.*)$/i.exec(line);
      if (why) reasons[why[1].toUpperCase()] = why[2].trim();
      continue;
    }
    const m = OPTION.exec(line);
    if (m && options.length < 6)
      options.push({
        letter: m[1].toUpperCase(),
        text: cleanOption(m[2]),
        marked: CHECK.test(m[2]),
      });
    else if (options.length === 0) stem.push(line);
  }

  const text = stem.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) issues.push({ question: number, code: 'NO_TEXT' });
  if (options.length < 2)
    issues.push({ question: number, code: 'FEW_OPTIONS' });
  if (options.some(o => !o.text))
    issues.push({ question: number, code: 'EMPTY_OPTION' });
  const letters = options.map(o => o.letter);
  if (new Set(letters).size !== letters.length)
    issues.push({ question: number, code: 'DUPLICATE_LETTER' });
  const marked = options.filter(o => o.marked).map(o => o.letter);
  let right = answer;
  if (marked.length > 1)
    issues.push({ question: number, code: 'SEVERAL_MARKS' });
  else if (marked.length === 1) {
    if (answer && answer !== marked[0])
      issues.push({ question: number, code: 'ANSWER_MISMATCH' });
    right = marked[0];
  }
  if (!right) issues.push({ question: number, code: 'NO_ANSWER' });
  else if (!letters.includes(right))
    issues.push({ question: number, code: 'ANSWER_NOT_AN_OPTION' });
  if (issues.length) return { issues };
  return {
    question: {
      text,
      options: options.map(o => ({
        text: o.text,
        correct: o.letter === right,
        explanation: o.letter === right ? (reasons[right] ?? null) : null,
      })),
    },
    issues,
  };
}

/** The questions of one quiz file, plus what could not be read. */
export function parseQuizLines(lines) {
  const blocks = [];
  for (const line of lines) {
    if (START.test(line)) blocks.push([line]);
    else if (blocks.length) blocks[blocks.length - 1].push(line);
  }
  const questions = [];
  const issues = [];
  blocks.forEach((b, i) => {
    const r = parseBlock(b, i + 1);
    if (r.question) questions.push(r.question);
    issues.push(...r.issues);
  });
  if (blocks.length === 0) issues.push({ question: 0, code: 'NO_QUESTIONS' });
  return { questions, issues };
}

/** The text a question is compared by: the question without its topic line, first 60 characters. */
export const stemKey = text => norm(text.split('\n\n').slice(-1)[0]).slice(0, 60);
