/**
 * Switch HAI_UI_ACTIONS for the tools of the HAI in the interface (open a page,
 * fill a form, focus, scroll). Pure, takes the environment as an argument so a
 * test can try every case.
 *
 *  - HAI_UI_ACTIONS=on (or true, 1, yes): on
 *  - everything else, also not set: OFF, in every environment (Preview, local,
 *    tests and Production). Unlike HAI_PAGE_CONTEXT there is no default "on"
 *    in Preview: the switch is set per environment on purpose
 *    (docs/go-checkliste.md, V10).
 *
 * With the switch off the prompt, the answers and the events are byte for byte
 * the ones without this feature.
 *
 * @module lib/hai/uiActions/config
 */

export const UI_ACTIONS_ENV = 'HAI_UI_ACTIONS';

type Env = Record<string, string | undefined>;

export function isUiActionsEnabled(env: Env = process.env): boolean {
  const value = String(env[UI_ACTIONS_ENV] ?? '')
    .trim()
    .toLowerCase();
  return ['on', 'true', '1', 'yes'].includes(value);
}
