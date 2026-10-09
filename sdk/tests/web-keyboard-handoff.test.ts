// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webAdapter } from '../src/platform/web';
import { createWebTextEditor } from '../src/platform/webTextEditor';

function bind() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const callbacks = {
    onKeyDown: vi.fn(() => true), onKeyUp: vi.fn(),
    onPointerDown: vi.fn(), onPointerUp: vi.fn(), onPointerMove: vi.fn(), onWheel: vi.fn(),
  };
  webAdapter.bindInputEvents(callbacks, canvas);
  return callbacks;
}
function key(target: EventTarget, code: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
afterEach(() => {
  webAdapter.unbindInputEvents();
  document.body.replaceChildren();
});

describe('Web keyboard handoff', () => {
  it('cancels defaults only when the callback claims the key', () => {
    const callbacks = bind();
    expect(key(document.body, 'Tab').defaultPrevented).toBe(true);
    callbacks.onKeyDown.mockReturnValue(false);
    expect(key(document.body, 'Tab').defaultPrevented).toBe(false);
  });
  it.each(['input', 'textarea', 'select', 'button', 'a', 'div'])('leaves host %s controls alone', tag => {
    const callbacks = bind();
    const control = document.createElement(tag);
    if (tag === 'a') control.setAttribute('href', '#');
    if (tag === 'div') control.setAttribute('contenteditable', 'true');
    document.body.appendChild(control);
    expect(key(control, 'Tab').defaultPrevented).toBe(false);
    expect(key(control, 'Enter').defaultPrevented).toBe(false);
    expect(callbacks.onKeyDown).not.toHaveBeenCalled();
  });
  it('keeps IME confirmation and browser shortcuts out of game activation', () => {
    const callbacks = bind();
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(key(document.body, 'Enter', options).defaultPrevented).toBe(false);
    }
    expect(callbacks.onKeyDown).not.toHaveBeenCalled();
  });
  it('routes the engine editor while keeping the parked textarea out of Tab order', () => {
    const callbacks = bind();
    const editor = createWebTextEditor()!;
    const textarea = document.querySelector('textarea')!;
    expect(textarea.tabIndex).toBe(-1);
    expect(key(textarea, 'Tab').defaultPrevented).toBe(true);
    expect(callbacks.onKeyDown).toHaveBeenCalledWith('Tab');
    editor.dispose();
  });
  it('releases held modifiers on blur and removes handlers on unbind', () => {
    const callbacks = bind();
    key(document.body, 'ShiftLeft');
    key(document.body, 'Tab');
    window.dispatchEvent(new Event('blur'));
    expect(callbacks.onKeyUp.mock.calls).toEqual([['ShiftLeft'], ['Tab']]);
    webAdapter.unbindInputEvents();
    expect(key(document.body, 'Tab').defaultPrevented).toBe(false);
    expect(callbacks.onKeyDown).toHaveBeenCalledTimes(2);
  });
});


it('does not submit or cancel the engine textarea during composition', () => {
  bind();
  const editor = createWebTextEditor()!;
  const events: string[] = [];
  editor.subscribe(event => events.push(event.kind));
  const textarea = document.querySelector('textarea')!;
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  key(textarea, 'Enter', { key: 'Enter' });
  key(textarea, 'Escape', { key: 'Escape' });
  expect(events).toEqual(['composition']);
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  key(textarea, 'Enter', { key: 'Enter' });
  expect(events.at(-1)).toBe('submit');
  editor.dispose();
});
