import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './Modal';
import { Drawer } from './Drawer';
import { Tabs } from './Tabs';
import { Toggle } from './Toggle';

/** Real DOM interaction tests (jsdom): clicks, keyboard, focus, Escape. */

describe('Toggle', () => {
  it('flips when clicked and reports the new value', async () => {
    const user = userEvent.setup();
    function Host() {
      const [on, setOn] = useState(false);
      return <Toggle checked={on} onChange={setOn} label="Enable" />;
    }
    render(<Host />);
    const sw = screen.getByRole('switch', { name: 'Enable' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('does not change when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Toggle checked={false} onChange={onChange} label="Enable" disabled reason="nope" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Tabs', () => {
  it('moves selection with arrow keys', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Sections"
        active="a"
        onChange={onChange}
        tabs={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
      />,
    );
    const selected = screen.getByRole('tab', { selected: true });
    selected.focus();
    fireEvent.keyDown(selected, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('ConfirmDialog', () => {
  it('closes on Escape and confirms on the action button', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete it?"
        confirmLabel="Delete"
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Drawer', () => {
  it('renders when open, hides when closed, and closes on the X button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Drawer open onClose={onClose} title="Editor">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Editor' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    rerender(
      <Drawer open={false} onClose={onClose} title="Editor">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
