// Reads the global quiz files of the FIAE Word delivery (06-01-26 LFA\FIAE\Komponenten\<nn>_...\Global_Quiz\Global_Quiz.docx).
// The 25 files come in about ten layouts (chat exports): "[Question 1] [CORRECTED QUESTION] (Topic: ...)", numbered
// titles, "[Quelle: ...] - Frage 1 (Schwierigkeit: ...)", options on one line, the right answer as a line
// "Lösung: B", "Korrekte Antwort: B", with a check mark or only as a bold option. A question is accepted only
// with a text, options A, B, C, ... in order and exactly one clear right answer. Everything else is reported,
// nothing is guessed.

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

/** The paragraphs of a .docx as { text, bold }: bold is the part of the text written in bold. */
export async function docxParagraphs(buffer) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml is missing');
  const xml = await entry.async('string');
  const out = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    let text = '';
    let bold = '';
    for (const r of p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []) {
      let t = '';
      for (const m of r.matchAll(
        /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g
      ))
        t += m[1] !== undefined ? m[1] : ' ';
      t = decode(t);
      text += t;
      if (/<w:b\s*\/>|<w:b\s+w:val="(?:1|true)"\s*\/>/.test(r)) bold += t;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, bold: bold.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/** Letters and digits only, lowercase: the same text in two layouts compares equal. */
export const norm = s =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^0-9a-zäöüß]+/g, '');

const OPTION = /^([A-F])\)\s*(.*)$/;
const ANSWER =
  /^(?:[✅✔☑✓]\s*)?\**(?:Lösung|Korrekte Antwort|Richtige Antwort|Correct Answer|Antwort)\**\s*:\s*\**\s*([A-F])\b/i;
const EXPLANATION =
  /^(?:ℹ️?\s*)?(?:Erklärung|Begründung|Internal Proof)\s*:\s*(.*)$/i;
const CHECK = /[✅✔☑✓]/;

// lines that only announce a question; the rest of the line, if any, belongs to the question text
const MARKERS = [
  /^\[(?:Question|Frage)\s*\d+[^\]]*\]\s*(.*)$/i,
  /^\[\d+\.?[^\]]*\]\s*(.*)$/,
  /^\[CORRECTED QUESTION\]\s*(?:\(Topic:[^)]*\))?\s*(.*)$/i,
  /^\[Quelle:[^\]]*\]\s*(?:[-–]\s*)?(?:Frage\s*\d+)?\s*(?:\(Schwierigkeit:[^)]*\))?\s*(.*)$/i,
  /^\(Schwierigkeit:[^)]*\)\s*(.*)$/i,
  /^Frage\s*\d+\s*:?\s*()$/i,
  /^Frage\s*:\s*(.*)$/i,
  /^Thema\s*:.*()$/i,
  /^Level\s*:.*()$/i,
];
// "12. Projektmanagement: Kritischer Weg" is a short numbered title in front of the question,
// "13. Distribution Die Distribution wird ... Welcher ...?" is a numbered question
const NUMBERED = /^\d+\.\s+(.*)$/;

const cleanOption = text =>
  text
    .replace(/\s*[✅✔☑✓]+\s*/g, ' ')
    .replace(/\s*\[vgl:[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A paragraph with the options behind each other ("A) x B) y C) z") to one paragraph per option. */
function splitInline(p) {
  // only a paragraph that starts with the first option: "(Produktgruppe A) nun auch ..." is question text
  if (!/^A\)\s/.test(p.text) || !/\sB\)\s/.test(p.text)) return [p];
  return p.text
    .split(/\s+(?=[B-F]\)\s)/)
    .map(piece => ({ text: piece.trim(), bold: '' }));
}

// the text counts as bold when most of its letters are bold (a bold letter "A)" alone does not count)
const isMarked = (p, text) => {
  const body = norm(text);
  return body.length > 0 && norm(p.bold).length >= body.length * 0.6;
};

function finish(cur, issues) {
  const fail = code => {
    issues.push({
      question: cur.number,
      code,
      text: cur.stem.join(' ').slice(0, 70),
    });
    return null;
  };
  const text = cur.stem.join(' ').replace(/\s+/g, ' ').trim();
  // "Note: This topic is not in the files, I will replace it" followed by the replacement question: withdrawn
  if (/^Note:/i.test(text)) return null;
  if (!text) return fail('NO_TEXT');
  if (cur.options.length < 2) return fail('FEW_OPTIONS');
  if (cur.options.some(o => !o.text)) return fail('EMPTY_OPTION');
  // a broken line ("seD) Das Geburtsdatum ...") ended up inside an option
  if (cur.options.some(o => /(^|\s)[A-Za-z]{0,3}[A-F]\)\s/.test(o.text)))
    return fail('BROKEN_OPTION');
  const letters = cur.options.map(o => o.letter);
  const marked = cur.options.filter(o => o.marked).map(o => o.letter);
  const checked = cur.options.filter(o => o.checked).map(o => o.letter);
  const sources = [
    ...(cur.answer ? [cur.answer] : []),
    ...(checked.length ? [checked.join('')] : []),
    // every option bold means the layout bolds all of them: no information
    ...(marked.length && marked.length < cur.options.length
      ? [marked.join('')]
      : []),
  ];
  if (sources.length === 0) return fail('NO_ANSWER');
  if (new Set(sources).size > 1) return fail('ANSWER_CONFLICT');
  const right = sources[0];
  if (right.length !== 1) return fail('SEVERAL_ANSWERS');
  if (!letters.includes(right)) return fail('ANSWER_NOT_AN_OPTION');
  const why = cur.explanation.join(' ').replace(/\s+/g, ' ').trim();
  return {
    text,
    options: cur.options.map(o => ({
      text: o.text,
      correct: o.letter === right,
      explanation: o.letter === right && why ? why : null,
    })),
    replacement: cur.replacement,
  };
}

/** The questions of one quiz file, plus what could not be read. */
export function parseGlobalQuiz(paragraphs) {
  const questions = [];
  const issues = [];
  let pending = [];
  let cur = null;
  let seen = 0;
  let replacement = false;

  const close = () => {
    if (!cur) return;
    const r = finish(cur, issues);
    if (r) questions.push(r);
    cur = null;
  };

  for (const p0 of paragraphs.flatMap(splitInline)) {
    const p = { ...p0, text: p0.text.trim() };
    if (!p.text) continue;

    const ans = ANSWER.exec(p.text);
    if (ans && cur && !cur.answer) {
      cur.answer = ans[1].toUpperCase();
      cur.state = 'after';
      continue;
    }
    const exp = EXPLANATION.exec(p.text);
    if (exp && cur) {
      cur.state = 'after';
      if (exp[1]) cur.explanation.push(exp[1]);
      continue;
    }

    const opt = OPTION.exec(p.text);
    if (opt) {
      const letter = opt[1];
      if (!cur && letter === 'A') {
        seen += 1;
        cur = {
          number: seen,
          stem: pending,
          options: [],
          answer: null,
          explanation: [],
          state: 'options',
          replacement,
        };
        pending = [];
        replacement = false;
      }
      if (cur && cur.state === 'options') {
        const expected = String.fromCharCode(65 + cur.options.length);
        if (letter === expected) {
          cur.options.push({
            letter,
            text: cleanOption(opt[2]),
            marked: isMarked(p, opt[2]),
            checked: CHECK.test(opt[2]),
          });
          continue;
        }
      }
      if (!cur) {
        pending.push(p.text); // a stray "D) ..." from a broken line
        continue;
      }
    }

    let marker = null;
    for (const m of MARKERS) {
      marker = m.exec(p.text);
      if (marker) break;
    }
    const numbered =
      !marker && (!cur || cur.state === 'after' || cur.options.length >= 2)
        ? NUMBERED.exec(p.text)
        : null;
    if (marker || numbered) {
      close();
      pending = [];
      if (/replacement/i.test(p.text)) replacement = true;
      if (marker && marker[1]) pending.push(marker[1]);
      // a short numbered line without a question mark is only a title
      if (numbered && (numbered[1].length > 90 || numbered[1].includes('?')))
        pending.push(numbered[1]);
      continue;
    }

    if (cur) {
      if (cur.state === 'after') {
        if (cur.explanation.length) cur.explanation.push(p.text);
      } else if (cur.options.length) {
        // a long option continued in the next paragraph
        const last = cur.options[cur.options.length - 1];
        last.text = cleanOption(`${last.text} ${p.text}`);
      }
      continue;
    }
    pending.push(p.text);
  }
  close();
  if (seen === 0) issues.push({ question: 0, code: 'NO_QUESTIONS' });
  return { questions, issues };
}

/** The text a question is compared by: first 60 letters and digits. */
export const stemKey = text => norm(text).slice(0, 60);
