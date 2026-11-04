import React, { useState } from 'react';
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import {
  FILLED_ATTRIBUTE,
  confirmPendingUiAction,
  discardPendingUiAction,
  dismissUiBar,
  getUiBarState,
  hasPendingUiAction,
  resetUiActionExecutor,
  runUiAction,
  undoUiAction,
} from '@/components/hai/uiActionExecutor';
import { HaiUiActionBar } from '@/components/hai/HaiUiActionBar';

// The executor in the browser: sets values in React's controlled fields, marks
// them, keeps the old values for "Rückgängig", and never clicks, never sends.
// It skips everything under data-hai-ignore, disabled, read only and wrongly
// typed fields, and only works on the page the form belongs to.

const PROFILE = '/trainee/profile';
const REPORTS = '/trainee/activity-reports';
const REVIEWS = '/trainer/reviews';

function fill(
  form: string,
  fields: Array<[string, string]>,
  extra: Record<string, unknown> = {}
) {
  return {
    tool: 'fill_form',
    form,
    fields: fields.map(([id, value]) => ({ id, value })),
    mode: 'apply',
    ...extra,
  };
}

let submitted = jest.fn();
let clicked = jest.fn();

/** A page with a controlled name field, like Profile.tsx (a React state behind it). */
function ProfileForm({ editing = true }: { editing?: boolean }) {
  const [name, setName] = useState('Alter Name');
  return (
    <main>
      <form onSubmit={submitted as unknown as React.FormEventHandler}>
        {editing && (
          <input
            id="fullName"
            data-hai-form="profile_name"
            data-hai-field="fullName"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        )}
        <output data-testid="state">{name}</output>
        <button type="submit" onClick={clicked as unknown as () => void}>
          Speichern
        </button>
      </form>
    </main>
  );
}

/** Two entries of a report: the form occurs twice. */
function ReportForm() {
  const [notes, setNotes] = useState(['', '']);
  const [hours, setHours] = useState([1, 1]);
  return (
    <main>
      {[0, 1].map(i => (
        <div key={i} data-hai-form="activity_report_entry">
          <textarea
            data-testid={`notes-${i}`}
            data-hai-field="notes"
            value={notes[i]}
            onChange={e =>
              setNotes(prev =>
                prev.map((v, j) => (j === i ? e.target.value : v))
              )
            }
          />
          <input
            data-testid={`hours-${i}`}
            data-hai-field="hours"
            type="number"
            value={hours[i]}
            onChange={e =>
              setHours(prev =>
                prev.map((v, j) => (j === i ? Number(e.target.value) : v))
              )
            }
          />
        </div>
      ))}
      <output data-testid="state">{JSON.stringify({ notes, hours })}</output>
    </main>
  );
}

beforeEach(() => {
  resetUiActionExecutor();
  submitted = jest.fn();
  clicked = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('filling a controlled React field', () => {
  it('sets the value so that React state follows, and marks the field', () => {
    render(<ProfileForm />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'applied', applied: 1, skipped: 0 });
    // React state (not only the DOM value) changed
    expect(screen.getByTestId('state').textContent).toBe('Max Mustermann');
    expect(input.value).toBe('Max Mustermann');
    expect(input.getAttribute(FILLED_ATTRIBUTE)).toBe('true');
    expect(getUiBarState()).toMatchObject({
      kind: 'applied',
      count: 1,
      labels: ['Name'],
      undone: false,
    });
  });

  it('puts the cleaned value in (markup and control characters are gone)', () => {
    render(<ProfileForm />);
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max <b>Muster</b>mann']]),
        document,
        PROFILE
      );
    });
    expect(screen.getByTestId('state').textContent).toBe('Max Mustermann');
  });

  it('never clicks, never submits, never sends', () => {
    const click = jest.spyOn(HTMLElement.prototype, 'click');
    const requestSubmit = jest.fn();
    const submit = jest.fn();
    HTMLFormElement.prototype.requestSubmit = requestSubmit;
    HTMLFormElement.prototype.submit = submit;
    const fetchSpy = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchSpy;
    render(<ProfileForm />);
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    act(() => undoUiAction());
    expect(click).not.toHaveBeenCalled();
    expect(clicked).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not touch a field under data-hai-ignore (the HAI panel, marked parts)', () => {
    render(
      <main>
        <div data-hai-ignore="">
          <input
            data-hai-form="profile_name"
            data-hai-field="fullName"
            defaultValue="Panel"
          />
        </div>
      </main>
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'form_missing' });
    expect(input.value).toBe('Panel');
    expect(input.hasAttribute(FILLED_ATTRIBUTE)).toBe(false);
  });

  it('skips a disabled and a read only field', () => {
    render(
      <main>
        <input
          data-hai-form="profile_name"
          data-hai-field="fullName"
          defaultValue="A"
          disabled
        />
      </main>
    );
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'no_change' });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('A');

    cleanupDom();
    render(
      <main>
        <input
          data-hai-form="profile_name"
          data-hai-field="fullName"
          defaultValue="B"
          readOnly
        />
      </main>
    );
    act(() => {
      outcome = runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'no_change' });
  });

  it.each(['password', 'email', 'hidden', 'file', 'checkbox', 'submit', 'tel'])(
    'never fills an input of the type %s, even with a matching attribute',
    type => {
      const { container } = render(
        <main>
          <input
            data-hai-form="profile_name"
            data-hai-field="fullName"
            type={type}
          />
        </main>
      );
      let outcome: ReturnType<typeof runUiAction> | undefined;
      act(() => {
        outcome = runUiAction(
          fill('profile_name', [['fullName', 'Max Mustermann']]),
          document,
          PROFILE
        );
      });
      expect(outcome).toEqual({ status: 'rejected', reason: 'no_change' });
      const el = container.querySelector('input') as HTMLInputElement;
      if (type !== 'checkbox') expect(el.value).not.toBe('Max Mustermann');
      expect(el.hasAttribute(FILLED_ATTRIBUTE)).toBe(false);
    }
  );

  it('does not fill a field that has no data-hai-field or another id', () => {
    render(
      <main>
        <div data-hai-form="profile_name">
          <input id="fullName" />
          <input data-hai-field="other" />
        </div>
      </main>
    );
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'no_change' });
  });

  it('rejects a foreign field or form of the event (checked again in the browser)', () => {
    render(<ProfileForm />);
    for (const event of [
      fill('profile_name', [['email', 'a@b.de']]),
      fill('quiz_answer', [['answer', 'B']]),
      fill('profile_name', [['fullName', 'x'.repeat(300)]]),
      { tool: 'click', form: 'profile_name' },
      null,
    ]) {
      let outcome: ReturnType<typeof runUiAction> | undefined;
      act(() => {
        outcome = runUiAction(event, document, PROFILE);
      });
      expect(outcome).toEqual({ status: 'rejected', reason: 'invalid' });
    }
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
  });

  it('only works on the page the form belongs to (the page may have changed)', () => {
    render(<ProfileForm />);
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        '/trainee/dashboard'
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'wrong_page' });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
    expect(getUiBarState()).toEqual({
      kind: 'notice',
      key: 'hai.uiAction.bar.wrongPage',
    });
  });

  it('says so when the form is not open (the edit mode of the profile is off)', () => {
    render(<ProfileForm editing={false} />);
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'form_missing' });
    expect(getUiBarState()).toEqual({
      kind: 'notice',
      key: 'hai.uiAction.bar.notFound',
    });
  });
});

describe('a form that occurs several times', () => {
  it('needs the entry number, and fills only that entry', () => {
    render(<ReportForm />);
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('activity_report_entry', [['notes', 'SQL geübt']]),
        document,
        REPORTS
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'ambiguous' });
    expect(getUiBarState()).toEqual({
      kind: 'notice',
      key: 'hai.uiAction.bar.ambiguous',
    });

    act(() => {
      outcome = runUiAction(
        fill(
          'activity_report_entry',
          [
            ['notes', 'SQL geübt'],
            ['hours', '4,5'],
          ],
          { entry: 2 }
        ),
        document,
        REPORTS
      );
    });
    expect(outcome).toEqual({ status: 'applied', applied: 2, skipped: 0 });
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({
      notes: ['', 'SQL geübt'],
      hours: [1, 4.5],
    });
  });

  it('rejects an entry that is not on the page', () => {
    render(<ReportForm />);
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('activity_report_entry', [['notes', 'x']], { entry: 5 }),
        document,
        REPORTS
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'form_missing' });
  });
});

describe('undo', () => {
  it('gives the old values back, through React, and removes the marks', () => {
    render(<ProfileForm />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    act(() => undoUiAction());
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
    expect(input.value).toBe('Alter Name');
    expect(input.hasAttribute(FILLED_ATTRIBUTE)).toBe(false);
    expect(getUiBarState()).toMatchObject({
      kind: 'applied',
      undone: true,
      kept: 0,
    });
  });

  it('leaves a field alone that the person changed after the HAI', () => {
    render(<ProfileForm />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    // a real edit of the person: the mark goes, and so does the undo for it
    fireEvent.change(input, { target: { value: 'Eigener Name' } });
    expect(input.hasAttribute(FILLED_ATTRIBUTE)).toBe(false);
    act(() => undoUiAction());
    expect(screen.getByTestId('state').textContent).toBe('Eigener Name');
  });

  it('dismissing the bar keeps the values and removes the marks', () => {
    render(<ProfileForm />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    act(() => dismissUiBar());
    expect(input.value).toBe('Max Mustermann');
    expect(input.hasAttribute(FILLED_ATTRIBUTE)).toBe(false);
    expect(getUiBarState()).toBeNull();
  });
});

describe('select, focus and scroll', () => {
  it('sets a select only to an option that exists', () => {
    function Filter() {
      const [status, setStatus] = useState('all');
      return (
        <main>
          <select
            data-hai-form="reviews_filter"
            data-hai-field="status"
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="all">Alle</option>
            <option value="pending">Offen</option>
          </select>
          <output data-testid="state">{status}</output>
        </main>
      );
    }
    render(<Filter />);
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('reviews_filter', [['status', 'pending']]),
        document,
        REVIEWS
      );
    });
    expect(outcome).toEqual({ status: 'applied', applied: 1, skipped: 0 });
    expect(screen.getByTestId('state').textContent).toBe('pending');
    // an allowed value of the register that this select does not offer
    act(() => {
      outcome = runUiAction(
        fill('reviews_filter', [['status', 'approved']]),
        document,
        REVIEWS
      );
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'no_change' });
    expect(screen.getByTestId('state').textContent).toBe('pending');
  });

  it('sets the focus and scrolls without a value', () => {
    const scroll = jest.fn();
    Element.prototype.scrollIntoView =
      scroll as unknown as typeof Element.prototype.scrollIntoView;
    render(<ProfileForm />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        {
          tool: 'focus_field',
          form: 'profile_name',
          field: 'fullName',
          mode: 'apply',
        },
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'focused' });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Alter Name');
    act(() => {
      outcome = runUiAction(
        { tool: 'scroll_to', form: 'profile_name', mode: 'apply' },
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'scrolled' });
    expect(scroll).toHaveBeenCalled();
    expect(input.hasAttribute(FILLED_ATTRIBUTE)).toBe(false);
  });
});

describe('a spoken turn (mode confirm)', () => {
  it('only shows the entry and enters nothing before the person confirms', () => {
    render(<ProfileForm />);
    let outcome: ReturnType<typeof runUiAction> | undefined;
    act(() => {
      outcome = runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']], {
          mode: 'confirm',
        }),
        document,
        PROFILE
      );
    });
    expect(outcome).toEqual({ status: 'pending' });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
    expect(hasPendingUiAction()).toBe(true);
    expect(getUiBarState()).toEqual({
      kind: 'pending',
      preview: [{ label: 'Name', value: 'Max Mustermann' }],
    });

    act(() => {
      confirmPendingUiAction(document, PROFILE);
    });
    expect(screen.getByTestId('state').textContent).toBe('Max Mustermann');
    expect(hasPendingUiAction()).toBe(false);
  });

  it('enters nothing when the person discards it, or when the page changed meanwhile', () => {
    render(<ProfileForm />);
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']], {
          mode: 'confirm',
        }),
        document,
        PROFILE
      );
    });
    act(() => discardPendingUiAction());
    expect(confirmPendingUiAction(document, PROFILE)).toBeNull();
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');

    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']], {
          mode: 'confirm',
        }),
        document,
        PROFILE
      );
    });
    let outcome: ReturnType<typeof confirmPendingUiAction> = null;
    act(() => {
      outcome = confirmPendingUiAction(document, '/trainee/dashboard');
    });
    expect(outcome).toEqual({ status: 'rejected', reason: 'wrong_page' });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
  });
});

describe('the bar', () => {
  function mountBar() {
    return renderWithProviders(
      <>
        <ProfileForm />
        <HaiUiActionBar />
      </>
    );
  }

  it('shows "bitte prüfen" and the undo button, and carries data-hai-ignore', () => {
    mountBar();
    expect(screen.queryByTestId('hai-ui-action-bar')).toBeNull();
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    const bar = screen.getByTestId('hai-ui-action-bar');
    expect(bar.getAttribute('data-status')).toBe('applied');
    expect(bar.hasAttribute('data-hai-ignore')).toBe(true);
    expect(bar.textContent).toContain('bitte prüfen');
    // labels only, never the value
    expect(bar.textContent).toContain('Name');
    expect(bar.textContent).not.toContain('Max Mustermann');

    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
    expect(
      screen.getByTestId('hai-ui-action-bar').getAttribute('data-status')
    ).toBe('undone');

    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByTestId('hai-ui-action-bar')).toBeNull();
  });

  it('shows the pending entry with "Eintragen" and "Verwerfen"', () => {
    mountBar();
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']], {
          mode: 'confirm',
        }),
        document,
        PROFILE
      );
    });
    const bar = screen.getByTestId('hai-ui-action-bar');
    expect(bar.getAttribute('data-status')).toBe('pending');
    expect(bar.textContent).toContain('Max Mustermann');
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(screen.queryByTestId('hai-ui-action-bar')).toBeNull();
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
  });

  it('shows a notice when nothing could be filled', () => {
    renderWithProviders(
      <>
        <ProfileForm editing={false} />
        <HaiUiActionBar />
      </>
    );
    act(() => {
      runUiAction(
        fill('profile_name', [['fullName', 'Max Mustermann']]),
        document,
        PROFILE
      );
    });
    expect(screen.getByTestId('hai-ui-action-bar').textContent).toContain(
      'nicht offen'
    );
  });
});

describe('the source of the executor', () => {
  it('has no click call, no submit call and no network call', () => {
    const source = fs
      .readFileSync(
        path.join(process.cwd(), 'src/components/hai/uiActionExecutor.ts'),
        'utf8'
      )
      // comments may name what the file never does
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/\.click\s*\(/);
    expect(source).not.toMatch(
      /dispatchEvent\(\s*new\s+\w*\.?\w*(?:Mouse|Pointer|Submit)/
    );
    expect(source).not.toMatch(/requestSubmit|\.submit\s*\(/);
    expect(source).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|sendBeacon|authFetch/
    );
    // it dispatches input and change only
    const events = [...source.matchAll(/new win\.Event\('(\w+)'/g)].map(
      m => m[1]
    );
    expect(events.sort()).toEqual(['change', 'input']);
  });
});

function cleanupDom() {
  document.body.innerHTML = '';
}
