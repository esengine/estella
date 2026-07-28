// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OverlayMenu.tsx — the glass dropdown the viewport overlay bars are made of.
 *
 * Lives here rather than inside a panel because the Viewport and the Game panel
 * both carry overlay controls, and two copies of a menu row is how the two bars
 * start looking almost the same.
 */
import { useRef, type ReactNode } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { Popover, usePopover } from '@/components/Popover';

export function OvDropdown({
  icon: Icon,
  label,
  title,
  children,
}: {
  icon: LucideIcon;
  label: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const pop = usePopover();
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ovbtn${pop.isOpen ? ' open' : ''}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={pop.isOpen}
        onClick={() => (pop.isOpen ? pop.close() : pop.open(btnRef.current))}
      >
        <Icon className="ic" size={13} strokeWidth={1.9} />
        {label}
        <ChevronDown className="cv" size={9} strokeWidth={2.5} />
      </button>
      {/* Item clicks bubble to the menu to dismiss; each runs its own handler. */}
      {pop.isOpen && pop.anchor && (
        <Popover anchor={pop.anchor} width="auto" className="popover--glass" onClose={pop.close}>
          <div role="menu" onClick={pop.close}>
            {children}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Multi-toggle menu row (checkbox box) — for the Show Flags menu. */
export function DdCheck({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <div className={`ovmenu-item${on ? ' on' : ''}`} role="menuitemcheckbox" aria-checked={on} onClick={onClick}>
      <span className="chk">{on && <Check size={8} strokeWidth={3.5} />}</span>
      <span className="l">{label}</span>
    </div>
  );
}

/**
 * Single-select menu row (tick mark, shown when active) — for the Snap menu.
 *
 * `disabled` is for a choice that exists but cannot act yet: it stays visible so
 * the menu's shape does not shift, and `title` should say what would enable it. A
 * row that looks clickable and does nothing is worse than a greyed one.
 */
export function DdRadio({
  on, label, onClick, disabled = false, title,
}: {
  on: boolean; label: string; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <div
      className={`ovmenu-item${on ? ' on' : ''}${disabled ? ' disabled' : ''}`}
      role="menuitemradio"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      title={title}
      onClick={disabled ? undefined : onClick}
    >
      <span className="tk"><Check size={11} strokeWidth={3} /></span>
      <span className="l">{label}</span>
    </div>
  );
}
