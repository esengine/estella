// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CommandPalette.tsx
 * @brief   The Ctrl/Cmd+Shift+P command palette: every registry command, fuzzy-
 *          filtered, keyboard-first (↑/↓ + Enter), keybinding hints, disabled
 *          commands greyed but listed (VS Code convention). Reuses the .ac
 *          picker chrome so it reads like the Add-Component palette.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchField } from '@/components/SearchField';
import { useDialogFocus } from '@/components/dialogFocus';
import { usePanelWindow } from '@/components/PanelWindow';
import { commands, formatKeybinding } from '@/commands';
import { filterPalette, paletteItems, type PaletteItem } from '@/commands/palette';
import { t } from '@/i18n';

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const win = usePanelWindow();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  useDialogFocus(shellRef);

  // Enablement is resolved once at open — the palette is a snapshot of what is
  // runnable now, and predicates read live store state (cheap but not reactive).
  const [items] = useState<PaletteItem[]>(() =>
    paletteItems(commands.all(), (id) => commands.keybindingFor(id)),
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    win.addEventListener('mousedown', close);
    win.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('mousedown', close);
      win.removeEventListener('keydown', onKey);
    };
  }, [onClose, win]);

  const filtered = useMemo(() => filterPalette(items, query), [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (item: PaletteItem) => {
    if (!item.enabled) return;
    onClose();
    commands.run(item.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[active];
      if (item) run(item);
    }
  };

  return createPortal(
    <div className="ac-scrim open" onMouseDown={onClose}>
      <div
        ref={shellRef}
        className="ac cp"
        role="dialog"
        aria-modal="true"
        aria-label={t('cmd.palette.open')}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <SearchField
          flush
          className="ac-search"
          iconSize={15}
          inputRef={inputRef}
          placeholder={t('palette.placeholder')}
          value={query}
          onChange={setQuery}
          onKeyDown={onKeyDown}
        >
          <kbd className="esc">Esc</kbd>
        </SearchField>

        <div className="ac-body">
          {filtered.length === 0 ? (
            <div className="empty-line">{t('palette.noMatch')}</div>
          ) : (
            filtered.map((item, idx) => {
              const isActive = idx === active;
              return (
                <button
                  key={item.id}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  className={`ac-item cp-item${isActive ? ' sel' : ''}${item.enabled ? '' : ' is-disabled'}`}
                  aria-disabled={!item.enabled}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => run(item)}
                >
                  <span className="at">
                    <div className="an">
                      {item.category && <span className="cp-cat">{item.category}: </span>}
                      {item.label}
                    </div>
                  </span>
                  {item.keybinding && <span className="cp-kb">{formatKeybinding(item.keybinding)}</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    win.document.body,
  );
}
