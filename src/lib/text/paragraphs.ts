/**
 * Text taken from a PDF carries a hard line break at the end of every printed
 * line. Shown with `whitespace-pre-line` those breaks cut the sentences in the
 * middle (the text of a Lernfeld looked torn). A blank line stays a paragraph
 * break and a line that starts like a list item (- , *, a bullet or "1.")
 * starts a new line, every other single line break becomes a space. Pure, no
 * imports.
 */

const LIST_ITEM = /^(?:[-*\u2022\u2013]\s+|\d+[.)]\s+)/;

export function joinHardLineBreaks(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map(paragraph => {
      const lines = paragraph
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      let out = '';
      for (const line of lines) {
        if (!out) out = line;
        else if (LIST_ITEM.test(line)) out += `\n${line}`;
        else out += ` ${line}`;
      }
      return out;
    })
    .filter(Boolean)
    .join('\n\n');
}
