/**
 * The UI tool step of the HAI pipeline, shared by the blocking and the
 * streaming path.
 *
 * Two places in a turn:
 *  1. BEFORE the model: `uiToolsPromptFor` gives the prompt section "Werkzeuge"
 *     (only with the switch on and when the message of the person asks for an
 *     input or a page).
 *  2. AFTER the model: `applyUiTools` takes the block out of the answer, checks
 *     the proposal on the server and returns the text for the person plus the
 *     event for the browser. The model decides nothing: every proposal goes
 *     through validate.ts (forms) or the navigation resolution (open_page).
 *
 * With the switch off both are no-ops: no section, the answer text is returned
 * unchanged, no event (byte for byte the behavior without this feature).
 *
 * Nothing here writes to the database, nothing here clicks.
 *
 * @module lib/hai/uiActions/flow
 */

import { checkRateLimit } from '@/lib/rate-limit';
import {
  proposePageByName,
  type NavigationFlowContext,
} from '../navigation/flow';
import type { NavigationOffer } from '../navigation/offer';
import type { RetrievalAccess } from '../retrievalAccess';
import { isUiActionsEnabled } from './config';
import type { UiActionEvent } from './event';
import { detectUiIntent, type UiIntent } from './intent';
import { createUiStreamFilter, extractUiBlocks, parseUiBlock } from './parse';
import { buildUiToolsSection } from './promptSection';
import type { UiRole } from './registry';
import {
  validateFormTool,
  type UiRejectReason,
  type UiValidationContext,
} from './validate';

type Env = Record<string, string | undefined>;

/** The turn as the UI tools see it. */
export interface UiToolsTurn {
  userId: string;
  /** The message of the person (never text of a page or a document). */
  userMessage: string;
  /** From the database: only the audience is read. */
  access: Pick<RetrievalAccess, 'audience'> | null;
  /** The path of the checked page context, or null. */
  pagePath: string | null;
  voice: boolean;
}

/** Accepted form calls per person and window (best effort, per instance). */
export const UI_RATE_LIMIT = Object.freeze({
  limit: 30,
  windowMs: 10 * 60 * 1000,
});

export const UI_NOTE_DROPPED =
  'Ich konnte nichts eintragen, das ist für dieses Formular oder deine Rolle nicht zulässig. Bitte trage es selbst ein oder sage mir, wobei ich helfen soll.';
export const UI_NOTE_RATE_LIMITED =
  'Es gab gerade zu viele Eingaben in kurzer Zeit. Bitte warte einen Moment und versuche es dann noch einmal.';
export const UI_NOTE_CONFIRM =
  'Ich habe die Eingabe vorbereitet, sie ist noch nicht eingetragen. Tippe im Text-Chat auf "Eintragen" oder schreibe "ja", dann trage ich sie ein. Gespeichert ist auch dann noch nichts.';

/** The fixed sentence after a filled form (the server writes it, not the model). */
export function uiNoteApplied(count: number): string {
  return `Ich habe ${count} ${count === 1 ? 'Feld' : 'Felder'} ausgefüllt. Gespeichert ist noch nichts, bitte prüfe es und speichere selbst.`;
}

/** The role of the person from the access (database), or null without access. */
export function uiRoleOf(
  access: Pick<RetrievalAccess, 'audience'> | null
): UiRole | null {
  if (!access) return null;
  return access.audience === 'trainer' ? 'TRAINER' : 'TRAINEE';
}

/** The prompt section for this turn, or undefined (switch off, nothing asked). */
export function uiToolsPromptFor(
  turn: UiToolsTurn,
  env: Env = process.env
): string | undefined {
  if (!isUiActionsEnabled(env)) return undefined;
  const role = uiRoleOf(turn.access);
  if (!role) return undefined;
  const section = buildUiToolsSection({
    role,
    pagePath: turn.pagePath,
    intent: detectUiIntent(turn.userMessage),
    voice: turn.voice,
  });
  return section || undefined;
}

export interface UiToolsOutcome {
  /** The answer without the block (the raw text when there was none). */
  text: string;
  /** A fixed sentence the pipeline puts after the text. */
  note?: string;
  uiAction?: UiActionEvent;
  /** The card for `open_page` (never `auto`). */
  navigationOffer?: NavigationOffer;
  /** Why a proposal was dropped (log and tests, never shown). */
  rejected?: UiRejectReason;
}

/**
 * Take the block out of the answer of the model and check what it proposes.
 * The text is only changed when the answer holds a block, so with the switch off
 * (or a normal answer) it is returned unchanged.
 */
export async function applyUiTools(
  rawText: string,
  turn: UiToolsTurn,
  navigation: NavigationFlowContext,
  access: RetrievalAccess | null,
  env: Env = process.env
): Promise<UiToolsOutcome> {
  if (!isUiActionsEnabled(env)) return { text: rawText };
  const extracted = extractUiBlocks(rawText);
  if (extracted.blocks.length === 0 && !extracted.unclosed) {
    return { text: rawText };
  }
  const text = extracted.text;
  const intent: UiIntent = detectUiIntent(turn.userMessage);
  const asked = intent.fill || intent.open;
  const dropped = (reason: UiRejectReason): UiToolsOutcome => ({
    text,
    // only tell the person when they asked for something, a block out of
    // nowhere (no request in the message) is cut out without a word
    ...(asked ? { note: UI_NOTE_DROPPED } : {}),
    rejected: reason,
  });

  const first = extracted.blocks[0] ? parseUiBlock(extracted.blocks[0]) : null;
  if (!first) return dropped('bad_shape');

  const role = uiRoleOf(turn.access);
  if (!role) return dropped('no_role');

  if (first.tool === 'open_page') {
    // the same message rule as the forms: the person has to ask
    if (!asked) return dropped('no_intent');
    const proposed = await proposePageByName(first.target, navigation, access);
    return proposed.ok
      ? { text, navigationOffer: proposed.offer }
      : { text, note: proposed.text, rejected: 'unknown_form' };
  }

  const ctx: UiValidationContext = {
    enabled: true,
    role,
    pagePath: turn.pagePath,
    intent,
    voice: turn.voice,
  };
  const checked = validateFormTool(first, ctx);
  if (!checked.ok) return dropped(checked.reason);

  // a limit per person and window (the check only counts accepted calls)
  const allowed = checkRateLimit(`hai-ui:${turn.userId}`, UI_RATE_LIMIT);
  if (!allowed.allowed) {
    return { text, note: UI_NOTE_RATE_LIMITED, rejected: 'rate_limited' };
  }

  const event = checked.event;
  if (event.tool !== 'fill_form') return { text, uiAction: event };
  return {
    text,
    uiAction: event,
    note:
      event.mode === 'confirm'
        ? UI_NOTE_CONFIRM
        : uiNoteApplied(event.fields?.length ?? 0),
  };
}

/** The answer text with the fixed sentence of the server after it. */
export function withUiNote(outcome: UiToolsOutcome): string {
  if (!outcome.note) return outcome.text;
  return outcome.text ? `${outcome.text}\n\n${outcome.note}` : outcome.note;
}

/**
 * The sink for the stream of the model: with the switch on a filter keeps the
 * block off the screen, with the switch off it is the sink itself (byte for
 * byte the same stream as before).
 */
export function uiStreamSink(
  send: (text: string) => void,
  env: Env = process.env
): { push: (text: string) => void; flush: () => void } {
  if (!isUiActionsEnabled(env)) return { push: send, flush: () => undefined };
  const filter = createUiStreamFilter(send);
  return {
    push: text => filter.push(text),
    flush: () => filter.flush(),
  };
}
