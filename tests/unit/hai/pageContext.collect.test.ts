// DOM collector of the page context (jsdom): only labelled entries and clear
// roles, nothing from data-hai-ignore, nothing from form fields, hard limits.

import {
  collectPageContext,
  currentPageContext,
} from '@/lib/hai/pageContext/collect';
import { PAGE_CONTEXT_LIMITS } from '@/lib/hai/pageContext/shared';

const ENABLER = '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001';
const COURSE = '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0004';

function page(html: string, title = ''): Document {
  document.title = title;
  document.body.innerHTML = html;
  return document;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
  window.history.replaceState({}, '', '/');
});

describe('collectPageContext', () => {
  it('reads the heading, the kind, the ids and the labelled entries', () => {
    const doc = page(`
      <nav><a href="/x">Menüpunkt</a></nav>
      <main>
        <h1>Enabler Normalisierung</h1>
        <ul>
          <li>Einführung in die Normalformen</li>
          <li data-hai-label="Übung 1">Übung 1 mit vielen weiteren Worten</li>
        </ul>
        <p>Ein langer Fließtext, der nicht gesendet werden darf.</p>
      </main>`);
    const result = collectPageContext(
      `/trainee/enablers/${ENABLER}`,
      doc,
      `?course=${COURSE}&tab=1`
    );
    expect(result).toEqual({
      path: `/trainee/enablers/${ENABLER}`,
      kind: 'enabler',
      title: 'Enabler Normalisierung',
      ids: [ENABLER, COURSE],
      visibleLabels: ['Einführung in die Normalformen', 'Übung 1'],
    });
    // not the whole page text
    expect(JSON.stringify(result)).not.toContain('Fließtext');
    expect(JSON.stringify(result)).not.toContain('Menüpunkt');
  });

  it('uses data-hai-label, role="listitem", rows and articles as entries', () => {
    const doc = page(`
      <main>
        <div role="listitem">Block 5 Berufsschule</div>
        <div role="article"><span>Use Case</span> Bestellsystem</div>
        <table><tbody>
          <tr role="row"><td>Anna Muster</td><td>45 %</td></tr>
        </tbody></table>
        <div data-hai-label="Ausbildungsnachweis KW 44">egal</div>
      </main>`);
    const { visibleLabels } = collectPageContext('/trainer/trainees', doc, '');
    expect(visibleLabels).toEqual(
      expect.arrayContaining([
        'Block 5 Berufsschule',
        'Use Case Bestellsystem',
        'Anna Muster 45 %',
        'Ausbildungsnachweis KW 44',
      ])
    );
  });

  it('leaves out everything below data-hai-ignore (the HAI panel carries it)', () => {
    const doc = page(`
      <main>
        <ul>
          <li>Sichtbarer Eintrag</li>
          <li data-hai-ignore>Geheimer Eintrag</li>
          <li>Eintrag mit <span data-hai-ignore>verstecktem</span> Teil</li>
        </ul>
        <div data-hai-ignore><ul><li>Im Chatpanel</li></ul><h2>Chat</h2></div>
        <div data-hai-ignore data-hai-label="Beschriftung im Panel"></div>
      </main>
      <aside data-hai-ignore><div role="listitem">Nachricht des Chats</div></aside>`);
    const { visibleLabels } = collectPageContext('/trainer/dashboard', doc, '');
    expect(visibleLabels).toContain('Sichtbarer Eintrag');
    expect(visibleLabels).toContain('Eintrag mit Teil');
    const all = visibleLabels.join('|');
    expect(all).not.toContain('Geheimer');
    expect(all).not.toContain('verstecktem');
    expect(all).not.toContain('Chatpanel');
    expect(all).not.toContain('Chat');
    expect(all).not.toContain('Panel');
    expect(all).not.toContain('nachricht');
  });

  it('never reads form fields, passwords, buttons or hidden elements', () => {
    const doc = page(`
      <main>
        <h1>Profil</h1>
        <ul>
          <li>
            Name
            <input type="text" value="Max Mustermann" />
            <input type="password" value="geheim123" />
            <textarea>Privater Text</textarea>
            <select><option>Option A</option></select>
            <button>Speichern</button>
            <div contenteditable="true">Bearbeitbar</div>
            <span hidden>Verborgen</span>
            <span aria-hidden="true">Dekoration</span>
            <script>var passwort = "x";</script>
          </li>
          <li><input value="Nur ein Feld" /></li>
        </ul>
      </main>`);
    const result = collectPageContext('/trainee/profile', doc, '');
    const all = JSON.stringify(result);
    expect(result.visibleLabels).toEqual(['Name']);
    for (const secret of [
      'Mustermann',
      'geheim123',
      'Privater Text',
      'Option A',
      'Speichern',
      'Bearbeitbar',
      'Verborgen',
      'Dekoration',
      'passwort',
      'Nur ein Feld',
    ]) {
      expect(all).not.toContain(secret);
    }
  });

  it('skips the heading row of a table', () => {
    const doc = page(`
      <main><table>
        <tr role="row"><th>Name</th><th>Fortschritt</th></tr>
        <tr role="row"><td>Ben</td><td>10 %</td></tr>
      </table></main>`);
    expect(
      collectPageContext('/trainer/trainees', doc, '').visibleLabels
    ).toEqual(['Ben 10 %']);
  });

  it('cuts a label at 80 characters, takes at most 25 labels and 1500 characters', () => {
    const items = Array.from(
      { length: 60 },
      (_, i) => `<li>Eintrag ${i} ${'x'.repeat(200)}</li>`
    ).join('');
    const doc = page(`<main><ul>${items}</ul></main>`);
    const { visibleLabels } = collectPageContext('/trainer/dashboard', doc, '');
    expect(visibleLabels.length).toBeLessThanOrEqual(
      PAGE_CONTEXT_LIMITS.labels
    );
    for (const label of visibleLabels) {
      expect(label.length).toBeLessThanOrEqual(PAGE_CONTEXT_LIMITS.label);
    }
    const total = visibleLabels.reduce((n, l) => n + l.length, 0);
    expect(total).toBeLessThanOrEqual(PAGE_CONTEXT_LIMITS.labelsTotal);
  });

  it('stops at 1500 characters in total even for 25 short-enough labels', () => {
    const items = Array.from(
      { length: 25 },
      (_, i) => `<li>${String(i).padStart(2, '0')} ${'a'.repeat(76)}</li>`
    ).join('');
    const doc = page(`<main><ul>${items}</ul></main>`);
    const { visibleLabels } = collectPageContext('/trainer/dashboard', doc, '');
    const total = visibleLabels.reduce((n, l) => n + l.length, 0);
    expect(total).toBeLessThanOrEqual(PAGE_CONTEXT_LIMITS.labelsTotal);
    expect(visibleLabels.length).toBeLessThan(25);
  });

  it('sends no label twice and no empty label', () => {
    const doc = page(
      `<main><ul><li>A</li><li>A</li><li>  </li><li>B</li></ul></main>`
    );
    expect(
      collectPageContext('/trainer/dashboard', doc, '').visibleLabels
    ).toEqual(['A', 'B']);
  });

  it('falls back to the document title without a heading, and ignores a heading in an ignored part', () => {
    const doc = page(
      `<div data-hai-ignore><h1>Chat</h1></div><main></main>`,
      'Dashboard | LFA'
    );
    expect(collectPageContext('/trainer/dashboard', doc, '').title).toBe(
      'Dashboard | LFA'
    );
  });

  it('sends only uuids as ids, never other query values', () => {
    const doc = page('<main><h1>Seite</h1></main>');
    const result = collectPageContext(
      '/trainee/courses',
      doc,
      '?name=Max&email=max@example.org&id=42'
    );
    expect(result.ids).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('max@example.org');
  });

  it('cuts the query off the path', () => {
    const doc = page('<main></main>');
    expect(collectPageContext('/trainee/courses?x=1', doc, '').path).toBe(
      '/trainee/courses'
    );
  });
});

describe('currentPageContext', () => {
  it('reads the location of the browser', () => {
    window.history.replaceState(
      {},
      '',
      `/trainee/enablers/${ENABLER}?c=${COURSE}`
    );
    document.body.innerHTML = '<main><h1>Normalisierung</h1></main>';
    const result = currentPageContext();
    expect(result).toMatchObject({
      path: `/trainee/enablers/${ENABLER}`,
      kind: 'enabler',
      title: 'Normalisierung',
      ids: [ENABLER, COURSE],
    });
  });

  it('never throws', () => {
    const spy = jest
      .spyOn(document, 'querySelectorAll')
      .mockImplementation(() => {
        throw new Error('broken dom');
      });
    expect(currentPageContext()).toBeUndefined();
    spy.mockRestore();
  });
});
