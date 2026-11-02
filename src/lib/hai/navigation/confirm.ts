/**
 * The short reply to the question "Soll ich sie öffnen?" of a spoken
 * conversation. Pure functions, used by the provider of the chat. Only a
 * spoken reply to an open offer can open a page, a typed chat never changes
 * the page by itself (the person taps "Öffnen").
 *
 * @module lib/hai/navigation/confirm
 */

import { foldText } from './fold';

/** Replies that mean "yes, open it": whole message only, not a part of a sentence. */
const OPEN_REPLY = new RegExp(
  '^(?:' +
    [
      'ja',
      'ja bitte',
      'ja gern',
      'ja gerne',
      'ja klar',
      'ja mach das',
      'ja oeffne sie',
      'ja oeffnen',
      'gern',
      'gerne',
      'klar',
      'ok',
      'okay',
      'bitte',
      'bitte oeffnen',
      'oeffnen',
      'oeffne',
      'oeffne sie',
      'oeffne es',
      'oeffne die seite',
      'mach auf',
      'mach sie auf',
      'mach das',
      'mach es auf',
      'los',
      'auf gehts',
      'genau',
    ].join('|') +
    ')(?: bitte| mal| doch| jetzt)*$'
);

/** Replies that mean "no": the offer is dropped. */
const DECLINE_REPLY = new RegExp(
  '^(?:nein|nee|noe|nicht|lieber nicht|nicht jetzt|abbrechen|stopp|stop|lass es|vergiss es|schon gut|danke nein)(?: danke| bitte)*$'
);

export function isOpenConfirmation(text: string): boolean {
  return OPEN_REPLY.test(foldText(text));
}

export function isOpenDecline(text: string): boolean {
  return DECLINE_REPLY.test(foldText(text));
}
