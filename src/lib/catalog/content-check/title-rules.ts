/**
 * Text rules for titles (pure): leftovers of an import in a title.
 *
 *  - glued words: a lower case letter directly followed by an upper case letter
 *    inside one word ("gestaltenInhaltsverzeichnis"), the typical result of a
 *    paragraph break that was lost when a Word file was converted. Proper names
 *    that are written that way on purpose (GitHub, JavaScript) are on the list
 *    of exceptions below. Extend the list when a name is reported by mistake.
 *  - broken encoding: the replacement character or the typical pairs of a UTF-8
 *    text that was read as Latin-1 ("Ã¤" for ä).
 */

/**
 * Words that contain a lower case letter followed by an upper case one on
 * purpose. Compared in lower case against the whole word.
 */
export const GLUED_WORD_EXCEPTIONS: ReadonlySet<string> = new Set(
  [
    'JavaScript',
    'TypeScript',
    'GitHub',
    'GitLab',
    'DevOps',
    'DevSecOps',
    'PowerShell',
    'PowerPoint',
    'SharePoint',
    'OneDrive',
    'OneNote',
    'LinkedIn',
    'YouTube',
    'WordPress',
    'WhatsApp',
    'FaceTime',
    'VirtualBox',
    'VMware',
    'TeamViewer',
    'AnyDesk',
    'LibreOffice',
    'OpenOffice',
    'BitLocker',
    'FileZilla',
    'MediaWiki',
    'DokuWiki',
    'PhpMyAdmin',
    'MacBook',
    'MacOS',
    'ChatGPT',
    'OpenAI',
    'NetBeans',
    'IntelliJ',
    'PhpStorm',
    'PyCharm',
    'WebStorm',
    'RaspberryPi',
    'ThinkPad',
    'AirDrop',
    'AirPlay',
    'PayPal',
    'TikTok',
    'LaTeX',
    'MariaDB',
    'MongoDB',
    'NodeJS',
    'GraphQL',
    'FastAPI',
    'SolarWinds',
    'PuTTY',
    'WireGuard',
    'OpenVPN',
    'OpenSSL',
    'OpenSSH',
    'ServiceNow',
    'ActiveDirectory',
  ].map(word => word.toLowerCase())
);

/** At least two lower case letters, then an upper case letter and a lower case one. */
const GLUED = /\p{Ll}{2,}\p{Lu}\p{Ll}+/u;
const WORD = /[\p{L}\p{N}]+/gu;

/**
 * The words of a text that look glued together (an import rest). Pure, the
 * words are returned as they stand in the text.
 */
export function gluedWords(text: string): string[] {
  const found: string[] = [];
  for (const word of text.match(WORD) ?? []) {
    if (!GLUED.test(word)) continue;
    if (GLUED_WORD_EXCEPTIONS.has(word.toLowerCase())) continue;
    found.push(word);
  }
  return found;
}

/** The replacement character, or a typical UTF-8 text that was read as Latin-1. */
const BROKEN_ENCODING =
  /\uFFFD|\u00C3[\u00A4\u00B6\u00BC\u0178\u201E\u2013\u0153\u0084\u0096\u009C]|\u00E2\u20AC/u;

export function hasBrokenEncoding(text: string): boolean {
  return BROKEN_ENCODING.test(text);
}

/** A title for comparing: lower case, one blank between words, no edge marks. */
export function normalizeTitle(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s.:;,\-\u2013\u2014]+|[\s.:;,\-\u2013\u2014]+$/g, '')
    .trim();
}
