/**
 * The tool layer of the HAI in the interface: ONE place with the names, the
 * parameters and the rules of every tool (pure data, no server imports). The
 * navigation (`open_page`) sits here next to the form tools, with the same
 * schema style.
 *
 * Nothing here executes. The server checks a proposal of the model (validate.ts
 * for the form tools, the navigation resolution for `open_page`), the browser
 * carries out the checked event (uiActionExecutor.ts). No tool writes to the
 * database, and no tool clicks.
 *
 * @module lib/hai/uiActions/tools
 */

import { MAX_FIELDS_PER_CALL } from './registry';

export type UiToolId = 'open_page' | 'fill_form' | 'focus_field' | 'scroll_to';

export interface UiToolSchema {
  name: UiToolId;
  /** What the message of the person has to ask for before the tool counts. */
  requires: 'open_or_fill' | 'fill';
  /** Parameters: name, type, whether it is required, the rule. */
  parameters: readonly {
    name: string;
    type: 'string' | 'number' | 'object';
    required: boolean;
    rule: string;
  }[];
  /** What the answer of the server carries. */
  answer: 'navigationOffer' | 'uiAction';
  /** The tool never writes to the database. Always false, a test holds it. */
  writesToDatabase: false;
  /** The tool never clicks and never sends. Always false, a test holds it. */
  clicks: false;
}

export const UI_TOOLS: readonly UiToolSchema[] = Object.freeze([
  {
    name: 'open_page',
    requires: 'open_or_fill',
    parameters: [
      {
        name: 'target',
        type: 'string',
        required: true,
        rule: 'Name of a menu entry or target, 2 to 60 letters, digits, spaces or hyphens. Resolved by the navigation (allow list, level, occupation), never a path.',
      },
    ],
    answer: 'navigationOffer',
    writesToDatabase: false,
    clicks: false,
  },
  {
    name: 'fill_form',
    requires: 'fill',
    parameters: [
      {
        name: 'form',
        type: 'string',
        required: true,
        rule: 'Id of the register, on exactly this page, for this role.',
      },
      {
        name: 'fields',
        type: 'object',
        required: true,
        rule: `Field id to value, 1 to ${MAX_FIELDS_PER_CALL} fields, each in the register, each value clean and within its limits. All or nothing.`,
      },
      {
        name: 'entry',
        type: 'number',
        required: false,
        rule: 'Position from 1 when the form occurs several times on the page.',
      },
    ],
    answer: 'uiAction',
    writesToDatabase: false,
    clicks: false,
  },
  {
    name: 'focus_field',
    requires: 'fill',
    parameters: [
      {
        name: 'form',
        type: 'string',
        required: true,
        rule: 'Id of the register.',
      },
      {
        name: 'field',
        type: 'string',
        required: true,
        rule: 'Field id of that form.',
      },
      {
        name: 'entry',
        type: 'number',
        required: false,
        rule: 'Position from 1 when the form occurs several times.',
      },
    ],
    answer: 'uiAction',
    writesToDatabase: false,
    clicks: false,
  },
  {
    name: 'scroll_to',
    requires: 'fill',
    parameters: [
      {
        name: 'form',
        type: 'string',
        required: true,
        rule: 'Id of the register.',
      },
      {
        name: 'field',
        type: 'string',
        required: false,
        rule: 'Field id of that form.',
      },
      {
        name: 'entry',
        type: 'number',
        required: false,
        rule: 'Position from 1 when the form occurs several times.',
      },
    ],
    answer: 'uiAction',
    writesToDatabase: false,
    clicks: false,
  },
]);

export function isUiToolId(value: unknown): value is UiToolId {
  return (
    typeof value === 'string' && UI_TOOLS.some(tool => tool.name === value)
  );
}
