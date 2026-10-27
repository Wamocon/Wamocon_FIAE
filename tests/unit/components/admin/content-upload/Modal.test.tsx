import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@/components/admin/content-upload/Modal';

function Harness({ initialFocus = false }: { initialFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Öffnen</button>
      <button>Danach</button>
      {open && (
        <Modal titleId="t" descriptionId="d" onClose={() => setOpen(false)}>
          <h2 id="t">Titel</h2>
          <p id="d">Beschreibung</p>
          <button>Eins</button>
          <button data-initial-focus={initialFocus ? '' : undefined}>
            Zwei
          </button>
          <button>Drei</button>
        </Modal>
      )}
    </div>
  );
}

describe('Modal', () => {
  it('is a modal dialog with a name and a description, in a portal under the body', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    const dialog = screen.getByRole('dialog', { name: 'Titel' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Beschreibung');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('takes the focus when it opens: the first control, or the one that asks for it', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByRole('button', { name: 'Eins' })).toHaveFocus();
    unmount();
    const again = userEvent.setup();
    render(<Harness initialFocus />);
    await again.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByRole('button', { name: 'Zwei' })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByRole('button', { name: 'Eins' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Zwei' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Drei' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Eins' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Drei' })).toHaveFocus();
    // never out to the page behind it
    expect(screen.getByRole('button', { name: 'Danach' })).not.toHaveFocus();
  });

  it('pulls the focus back in when it is somewhere else', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    screen.getByRole('button', { name: 'Danach' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Eins' })).toHaveFocus();
  });

  it('closes with Escape and gives the focus back to what had it before', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Öffnen' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('holds the focus on the dialog itself when it has nothing to focus', async () => {
    const user = userEvent.setup();
    render(
      <Modal titleId="t" onClose={() => undefined}>
        <h2 id="t">Nur Text</h2>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    await user.tab();
    expect(dialog).toHaveFocus();
  });
});
