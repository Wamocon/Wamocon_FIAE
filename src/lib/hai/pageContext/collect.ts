/**
 * Browser side of the page context: reads the path, the heading and a few short
 * labels of the visible list entries and cards from the DOM.
 *
 * Rules (the server checks them again, nothing here is trusted):
 *  - only elements with data-hai-label or with a clear role (list item, row,
 *    article, h2, h3 inside the main area), never the whole text of the page
 *  - nothing from an element marked data-hai-ignore (the HAI panel carries it),
 *    nothing from form controls (input, textarea, select, contenteditable),
 *    scripts, styles, hidden elements
 *  - at most 25 labels of at most 80 characters, 1500 characters together
 *  - ids only as uuids from the path or the query
 *
 * @module lib/hai/pageContext/collect
 */

import {
  PAGE_CONTEXT_LIMITS,
  pageKindForPath,
  uuidsFromLocation,
  type PageContextInput,
} from './shared';

/** An element and everything below it is left out. */
const IGNORE_SELECTOR = '[data-hai-ignore]';
/** Form controls and the like: their value is never read. */
const CONTROL_SELECTOR =
  'input, textarea, select, option, button, script, style, noscript, template, [contenteditable=""], [contenteditable="true"], [hidden], [aria-hidden="true"]';
/** The elements that stand for one entry of a list or one card. */
const LABEL_SELECTOR = [
  '[data-hai-label]',
  '[role="listitem"]',
  '[role="row"]',
  '[role="article"]',
  'main li',
  'main article',
  'main h2',
  'main h3',
].join(', ');

function isIgnored(el: Element): boolean {
  return el.closest(IGNORE_SELECTOR) !== null;
}

/** Text of an element without the text of controls and ignored parts. */
function visibleText(el: Element): string {
  const parts: string[] = [];
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (
      parent &&
      parent.closest(CONTROL_SELECTOR) === null &&
      parent.closest(IGNORE_SELECTOR) === null
    ) {
      parts.push(node.textContent ?? '');
    }
    node = walker.nextNode();
  }
  return parts.join(' ');
}

/** One short line: spaces collapsed, cut at the limit. */
function shortLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? line.slice(0, max).trimEnd() : line;
}

/** The label of one element: its data-hai-label or the start of its text. */
function labelOf(el: Element): string {
  const attr = el.getAttribute('data-hai-label');
  if (attr !== null && attr.trim() !== '') {
    return shortLine(attr, PAGE_CONTEXT_LIMITS.label);
  }
  // the first line of the text: a card often has a title and then more text
  const text = visibleText(el);
  return shortLine(text, PAGE_CONTEXT_LIMITS.label);
}

/** The heading of the page: first h1 of the main area, else the document title. */
function titleOf(doc: Document): string {
  // `main h1` first: the sidebar brand is an h1 that comes first in the DOM, a
  // single selector list ('main h1, h1') would return it before the page heading
  const headings = [
    ...Array.from(doc.querySelectorAll('main h1')),
    ...Array.from(doc.querySelectorAll('h1')),
  ];
  for (const h of headings) {
    if (isIgnored(h)) continue;
    const text = shortLine(visibleText(h), PAGE_CONTEXT_LIMITS.title);
    if (text) return text;
  }
  return shortLine(doc.title ?? '', PAGE_CONTEXT_LIMITS.title);
}

/**
 * The page context of the page the browser shows right now, or undefined (no
 * window, or the DOM could not be read). Never throws: a chat message must not
 * fail because of the page context.
 */
export function currentPageContext(): PageContextInput | undefined {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }
    return collectPageContext(window.location.pathname);
  } catch {
    return undefined;
  }
}

/**
 * The page context of the current page. `doc` is the document (a test passes a
 * jsdom one), `search` the query string (default: the one of the location).
 */
export function collectPageContext(
  path: string,
  doc: Document = document,
  search: string = typeof window !== 'undefined' ? window.location.search : ''
): PageContextInput {
  const labels: string[] = [];
  let total = 0;
  const seen = new Set<string>();

  const elements = Array.from(doc.querySelectorAll(LABEL_SELECTOR));
  for (const el of elements) {
    if (labels.length >= PAGE_CONTEXT_LIMITS.labels) break;
    if (isIgnored(el)) continue;
    // a control is no entry (a form field is no label, its value never leaves)
    if (el.matches(CONTROL_SELECTOR)) continue;
    // a row of column headings is no entry
    if (
      el.getAttribute('role') === 'row' &&
      el.querySelector('th, [role="columnheader"]')
    ) {
      continue;
    }
    const label = labelOf(el);
    if (!label || seen.has(label)) continue;
    if (total + label.length > PAGE_CONTEXT_LIMITS.labelsTotal) break;
    seen.add(label);
    labels.push(label);
    total += label.length;
  }

  return {
    path: path.split('?')[0].slice(0, PAGE_CONTEXT_LIMITS.path),
    kind: pageKindForPath(path),
    title: titleOf(doc),
    ids: uuidsFromLocation(path, search),
    visibleLabels: labels,
  };
}
