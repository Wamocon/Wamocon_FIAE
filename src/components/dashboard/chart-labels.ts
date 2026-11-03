/**
 * Labels of the dashboard charts. Pure, no imports.
 *
 * A name of a skill or a question set is long ("Auftragsbearbeitung
 * durchführen"), the axis of a chart has little room. The label is broken into
 * lines at the spaces (radar chart) or cut with "..." (bar chart), the whole
 * name always stays available as a tooltip.
 */

/**
 * Break a label into at most `maxLines` lines of about `maxChars` characters,
 * at the spaces. A word longer than a line stays whole on its own line. What
 * does not fit into the last line is cut with "...".
 */
export function wrapLabel(
  text: string,
  maxChars: number,
  maxLines: number
): string[] {
  const words = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  let index = 0;
  for (; index < words.length; index++) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) {
      current = next;
      continue;
    }
    if (lines.length === maxLines - 1) break;
    lines.push(current);
    current = word;
  }
  if (index < words.length) {
    // the last line takes what is left, shortened
    const rest = [current, ...words.slice(index)].join(' ');
    lines.push(shortenLabel(rest, maxChars));
  } else if (current) {
    lines.push(current);
  }
  return lines;
}

/** Cut a label to `max` characters, with "..." when something was cut. */
export function shortenLabel(text: string, max: number): string {
  const value = String(text ?? '');
  return value.length > max
    ? `${value.slice(0, Math.max(1, max - 3))}...`
    : value;
}
