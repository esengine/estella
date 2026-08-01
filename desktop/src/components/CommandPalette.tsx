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
import { Sparkles } from 'lucide-react';
import { SearchField } from '@/components/SearchField';
import { useDialogFocus } from '@/components/dialogFocus';
import { usePanelWindow } from '@/components/PanelWindow';
import { commands, formatKeybinding } from '@/commands';
import { filterPalette, paletteItems, readsAsSentence, type PaletteItem } from '@/commands/palette';
import { useEditorStore } from '@/store/editorStore';
import { sendAgentMessage } from '@/store/AgentStore';
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

  // "Type a command, get a command; type a sentence, the first row becomes Hand
  // to Agent." The row is OFFERED whenever the text reads as something said —
  // but it is only SELECTED when no command matches, so `save scene` still
  // saves the scene rather than being narrated at a model.
  const offerAgent = readsAsSentence(query);
  // Index -1 IS the agent row: reachable with ↑ whenever it is offered, and the
  // default only when there is no command to prefer over it.
  const agentFirst = offerAgent && filtered.length === 0;

  useEffect(() => {
    setActive(agentFirst ? -1 : 0);
  }, [query, agentFirst]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (item: PaletteItem) => {
    if (!item.enabled) return;
    onClose();
    commands.run(item.id);
  };

  const handOff = () => {
    onClose();
    useEditorStore.getState().setAgentDrawer(true);
    void sendAgentMessage(query.trim());
  };

  // The agent row sits at index -1 when it is the default, so ↓ walks from it
  // into the commands and ↑ comes back.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(offerAgent ? -1 : 0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (offerAgent && active < 0) {
        handOff();
        return;
      }
      const item = filtered[active];
      if (item) run(item);
      else if (offerAgent) handOff();
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
          {offerAgent && (
            <>
              <button
                type="button"
                className={`ac-item cp-item cp-agent${active < 0 ? ' sel' : ''}`}
                onMouseEnter={() => setActive(-1)}
                onClick={handOff}
              >
                <span className="at">
                  <div className="an">
                    <Sparkles size={13} strokeWidth={1.8} />
                    {t('agent.handOff')}
                    <span className="cp-cat"> · {t('agent.handOff.sub')}</span>
                  </div>
                </span>
                <span className="cp-kb">Enter</span>
              </button>
              {filtered.length > 0 && <div className="cp-sep" />}
            </>
          )}
          {filtered.length === 0 && !offerAgent ? (
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
