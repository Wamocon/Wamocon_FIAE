/**
 * The block of the model (pure): finding it in the answer, taking it out of the
 * text, reading its JSON, and the filter that keeps it out of the stream.
 *
 * Form of the block, always at the END of the answer, without a code fence:
 *
 *   <hai-ui>{"tool":"fill_form","form":"profile_name","fields":{...}}</hai-ui>
 *
 * Rules:
 *  - Every block is cut out of the text, valid or not: the person never sees
 *    raw JSON, also not in the stream.
 *  - Only the FIRST block counts (one form per answer), later ones are dropped.
 *  - An unclosed block (the answer was cut off) is cut out and counts as no block.
 *  - The JSON is read with JSON.parse in a try, a plain object only, limited
 *    in size.
 *
 * @module lib/hai/uiActions/parse
 */

export const UI_BLOCK_OPEN = '<hai-ui>';
export const UI_BLOCK_CLOSE = '</hai-ui>';

/** Longest block read, in characters (a cut-off or hostile block is dropped). */
export const MAX_BLOCK_LENGTH = 8000;

const BLOCK_RE = /<hai-ui>([\s\S]*?)<\/hai-ui>/gi;

export interface ExtractedBlocks {
  /** The answer without any block (and without the code fence around it). */
  text: string;
  /** The inner text of each complete block, in order. */
  blocks: string[];
  /** An opened block was never closed. */
  unclosed: boolean;
}

/** Take every block out of an answer. Text without a block is returned as is. */
export function extractUiBlocks(raw: string): ExtractedBlocks {
  if (!/<\/?hai-ui/i.test(raw)) {
    return { text: raw, blocks: [], unclosed: false };
  }
  const blocks: string[] = [];
  let text = raw.replace(BLOCK_RE, (_all, inner: string) => {
    blocks.push(inner);
    return '';
  });
  let unclosed = false;
  const open = text.search(/<hai-ui/i);
  if (open >= 0) {
    unclosed = true;
    text = text.slice(0, open);
  }
  // a stray closing tag
  text = text.replace(/<\/hai-ui>/gi, '');
  // the code fence a model sometimes puts around the block stays empty
  text = text
    .replace(/```[a-zA-Z]*\s*```/g, '')
    .trimEnd()
    .replace(/(?:^|\n)[ \t]*```[a-zA-Z]*$/, '');
  return { text: text.trimEnd(), blocks, unclosed };
}

/** The JSON of a block as a plain object, or null (anything else). */
export function parseUiBlock(inner: string): Record<string, unknown> | null {
  if (typeof inner !== 'string' || inner.length > MAX_BLOCK_LENGTH) return null;
  const cleaned = inner
    .trim()
    // a fence inside the block
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
  if (!cleaned.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(cleaned);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The length of the longest end of `text` that is the beginning of the opening
 * tag (also cut in the middle of a chunk), so it can be held back.
 */
function partialOpenLength(text: string): number {
  const tag = UI_BLOCK_OPEN;
  const max = Math.min(text.length, tag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (tag.startsWith(text.slice(text.length - length).toLowerCase())) {
      return length;
    }
  }
  return 0;
}

export interface UiStreamFilter {
  /** Hand a chunk of the model to the filter. */
  push(chunk: string): void;
  /** The model is done: send what was held back (not a block). */
  flush(): void;
}

/**
 * A filter between the model and the stream to the client: passes the text up
 * to the start of a block, holds back the end of a chunk that could be the
 * start of one, and swallows everything from the block on. The finished answer
 * is cut by `extractUiBlocks` again, the filter only keeps raw JSON off the
 * screen while the text streams.
 */
export function createUiStreamFilter(
  send: (text: string) => void
): UiStreamFilter {
  let held = '';
  let inBlock = false;
  return {
    push(chunk: string) {
      if (inBlock || !chunk) return;
      held += chunk;
      const open = held.toLowerCase().indexOf(UI_BLOCK_OPEN);
      if (open >= 0) {
        // the blank space before a block is dropped (the finished answer is
        // cut the same way), so the stream and the stored text stay the same
        const before = held.slice(0, open).trimEnd();
        inBlock = true;
        held = '';
        if (before) send(before);
        return;
      }
      const keep = partialOpenLength(held);
      const out = held.slice(0, held.length - keep).trimEnd();
      // blank space at the end waits for the next piece: a block may follow it
      held = held.slice(out.length);
      if (out) send(out);
    },
    flush() {
      if (!inBlock && held) send(held);
      held = '';
    },
  };
}
