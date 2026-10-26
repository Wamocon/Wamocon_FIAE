/**
 * HAI persona of a training catalog (occupation): the settings key `hai` of
 * training_catalogs.settings. Pure functions without server or React imports.
 *
 * The values end up inside the system prompt of HAI, so they are checked
 * strictly (see HAI_TEXT): one line of plain text from a small alphabet, with a
 * length limit per field. There is no way to write a line break, a heading
 * (#), emphasis (*), a code fence (`), an angle bracket, a bracket, a brace, a
 * pipe, a backslash, a double quote or a control or bidi character, so a value
 * can neither open a new prompt section nor close the text it sits in. What
 * stays possible is an instruction in plain words. Therefore only a
 * SUPER_ADMIN may write the key (the admin editing is not part of the persona
 * package) and the text is shown to the model as part of its own rules, never
 * as quoted user content.
 *
 * Documented keys (snake_case, as stored in the database); every key is
 * optional, FIAE ignores the whole key and keeps today's texts:
 *  - occupation_name      formal name of the occupation (3 to 80 characters)
 *  - field_name           short name of the field, for "Thema X" and the
 *                         greeting (3 to 60), default occupation_name
 *  - glossary             up to 12 extra terms { term, definition }
 *  - allowed_topics       up to 15 extra topics the trainee may ask about
 *  - learning_field_label label of a school learning field, for example "LF"
 *  - learning_field_max   highest learning field number (FIAE 12, KfBM 13)
 *  - exam_name            name of the exam
 *  - exam_parts           [part one, part two] of a split exam, chosen by the
 *                         training phase of the trainee
 *  - source_rule          rule for the sources of subject statements
 *  - code_help            true if HAI helps with program code
 *  - offtopic_exceptions  up to 60 lower case words (4 to 30 characters) that keep a message out
 *                         of the off-topic filter (procurement, travel costs)
 *  - greeting             greeting of HAI (one line)
 *  - refusal_text         answer for questions outside the field
 *
 * Fixed numbers (counts of components or units) are not part of the persona.
 */

import { z } from 'zod';

/** The shark of HAI is the only emoji, and only in greeting and refusal. */
const SHARK = '\\u{1F988}';

// Letters (any script, with umlauts) and digits, first character a letter or
// digit, then a few separators. No quotes, angle brackets, brackets, braces,
// pipe, backslash, hash, asterisk, backtick, tilde, dollar, line breaks,
// control, zero width or bidi characters. Built from strings so the regular
// expressions with Unicode property escapes do not depend on the TS target.
const SEPARATORS = " .,;:!?()/&+'%\\-_€";
const HAI_TEXT = new RegExp(
  `^[\\p{L}\\p{N}][\\p{L}\\p{N}${SEPARATORS}]*$`,
  'u'
);
const HAI_TEXT_WITH_SHARK = new RegExp(
  `^[\\p{L}\\p{N}][\\p{L}\\p{N}${SEPARATORS}${SHARK}]*$`,
  'u'
);
const EXCEPTION_WORD = new RegExp(
  '^[\\p{Ll}\\p{N}][\\p{Ll}\\p{N} \\-]{2,28}[\\p{Ll}\\p{N}]$',
  'u'
);
// Letters that draw nothing (Hangul fillers) would allow invisible text
const INVISIBLE_LETTER = /[\u115F\u1160\u3164\uFFA0]/;
const LEARNING_FIELD_LABEL = /^[A-Za-z]{1,4}$/;

/** One line of persona text: length 3 to `max`, small alphabet, trimmed. */
export function isValidHaiText(
  value: unknown,
  max: number,
  options: { min?: number; shark?: boolean } = {}
): value is string {
  if (typeof value !== 'string') return false;
  const min = options.min ?? 3;
  if (value.length < min || value.length > max) return false;
  if (value !== value.trim()) return false;
  if (INVISIBLE_LETTER.test(value)) return false;
  return (options.shark ? HAI_TEXT_WITH_SHARK : HAI_TEXT).test(value);
}

const haiText = (
  max: number,
  options: { min?: number; shark?: boolean } = {}
) =>
  z
    .string()
    .refine(
      v => isValidHaiText(v, max, options),
      `one line of plain text, ${options.min ?? 3} to ${max} characters`
    );

const exceptionWord = z
  .string()
  .refine(
    v => EXCEPTION_WORD.test(v),
    'lower case word, 4 to 30 characters, letters, digits, space, hyphen'
  );

const glossaryEntry = z
  .object({
    term: haiText(40, { min: 2 }),
    definition: haiText(200),
  })
  .strict();

/** Strict schema for the key `hai` (rejects unknown keys and bad values). */
export const haiSettingsSchema = z
  .object({
    occupation_name: haiText(80),
    field_name: haiText(60),
    glossary: z.array(glossaryEntry).max(12),
    allowed_topics: z.array(haiText(80)).max(15),
    learning_field_label: z
      .string()
      .refine(v => LEARNING_FIELD_LABEL.test(v), 'one to four letters'),
    learning_field_max: z.number().int().min(1).max(20),
    exam_name: haiText(60),
    exam_parts: z.tuple([haiText(60), haiText(60)]),
    source_rule: haiText(300),
    code_help: z.boolean(),
    offtopic_exceptions: z.array(exceptionWord).max(60),
    greeting: haiText(300, { shark: true }),
    refusal_text: haiText(400, { shark: true }),
  })
  .partial()
  .strict();

export type HaiSettingsInput = z.infer<typeof haiSettingsSchema>;

/** The persona settings in camelCase, only the keys that were valid. */
export interface HaiSettings {
  occupationName?: string;
  fieldName?: string;
  glossary?: Array<{ term: string; definition: string }>;
  allowedTopics?: string[];
  learningFieldLabel?: string;
  learningFieldMax?: number;
  examName?: string;
  examParts?: [string, string];
  sourceRule?: string;
  codeHelp?: boolean;
  offTopicExceptions?: string[];
  greeting?: string;
  refusalText?: string;
}

/**
 * Tolerant read of a stored `hai` object: every key is checked on its own, an
 * invalid or missing key is left out and unknown keys are ignored. Never
 * throws. Returns null if nothing usable is stored.
 */
export function resolveHaiSettings(raw: unknown): HaiSettings | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const shape = haiSettingsSchema.shape;
  const out: HaiSettings = {};

  const occupationName = shape.occupation_name.safeParse(
    source.occupation_name
  );
  if (occupationName.success && occupationName.data !== undefined) {
    out.occupationName = occupationName.data;
  }
  const fieldName = shape.field_name.safeParse(source.field_name);
  if (fieldName.success && fieldName.data !== undefined) {
    out.fieldName = fieldName.data;
  }
  const glossary = shape.glossary.safeParse(source.glossary);
  if (glossary.success && glossary.data !== undefined) {
    out.glossary = glossary.data.map(e => ({
      term: e.term,
      definition: e.definition,
    }));
  }
  const allowedTopics = shape.allowed_topics.safeParse(source.allowed_topics);
  if (allowedTopics.success && allowedTopics.data !== undefined) {
    out.allowedTopics = allowedTopics.data;
  }
  const label = shape.learning_field_label.safeParse(
    source.learning_field_label
  );
  if (label.success && label.data !== undefined) {
    out.learningFieldLabel = label.data;
  }
  const max = shape.learning_field_max.safeParse(source.learning_field_max);
  if (max.success && max.data !== undefined) {
    out.learningFieldMax = max.data;
  }
  const examName = shape.exam_name.safeParse(source.exam_name);
  if (examName.success && examName.data !== undefined) {
    out.examName = examName.data;
  }
  const examParts = shape.exam_parts.safeParse(source.exam_parts);
  if (examParts.success && examParts.data !== undefined) {
    out.examParts = [examParts.data[0], examParts.data[1]];
  }
  const sourceRule = shape.source_rule.safeParse(source.source_rule);
  if (sourceRule.success && sourceRule.data !== undefined) {
    out.sourceRule = sourceRule.data;
  }
  const codeHelp = shape.code_help.safeParse(source.code_help);
  if (codeHelp.success && codeHelp.data !== undefined) {
    out.codeHelp = codeHelp.data;
  }
  const exceptions = shape.offtopic_exceptions.safeParse(
    source.offtopic_exceptions
  );
  if (exceptions.success && exceptions.data !== undefined) {
    out.offTopicExceptions = exceptions.data;
  }
  const greeting = shape.greeting.safeParse(source.greeting);
  if (greeting.success && greeting.data !== undefined) {
    out.greeting = greeting.data;
  }
  const refusal = shape.refusal_text.safeParse(source.refusal_text);
  if (refusal.success && refusal.data !== undefined) {
    out.refusalText = refusal.data;
  }

  return Object.keys(out).length > 0 ? out : null;
}
