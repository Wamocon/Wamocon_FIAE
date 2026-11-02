/**
 * Text of the navigation answers. A title or a course name is content that
 * trainers wrote and it is shown as markdown in the chat, so it is reduced to
 * plain text: no markup character, no line break, no quote that could end the
 * sentence, no link or image.
 *
 * @module lib/hai/navigation/text
 */

/** A title as plain text for a sentence (at most 120 characters). */
export function plainText(title: string): string {
  return (
    String(title ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f"`*_\[\]()!<>#|~\\]/g, ' ')
      // no address that the chat could turn into a link
      .replace(/:\/\//g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
  );
}
