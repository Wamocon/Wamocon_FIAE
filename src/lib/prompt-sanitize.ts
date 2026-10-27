/**
 * Shared cleaning of text that goes into a prompt.
 *
 * Moved out of src/lib/hai/prompts.ts so the HAI prompts and the upload
 * excerpts clean text the same way. The behaviour is unchanged.
 *
 * @module lib/prompt-sanitize
 */

/** Characters without a visible form: control, bidi, zero width, joiners. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u061C\u180E\u200B-\u200F\u2060-\u2064\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Text that comes from a person or from stored chats is data, never an
 * instruction: invisible characters are removed, every kind of line break
 * becomes a plain one and heading markers at the start of a line are dropped,
 * so the text cannot open a new section of the system prompt.
 */
export function sanitizePromptData(text: string, maxLength = Infinity): string {
  return text
    .replace(INVISIBLE, '')
    .replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n')
    .split('\n')
    .map(line => line.replace(/^(\s*)#+\s*/, '$1'))
    .join('\n')
    .slice(0, maxLength);
}
