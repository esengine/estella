// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    OverlayDrawer.tsx
 * @brief   A surface you SUMMON: a scrim over the workspace and a panel that
 *          slides in from one edge, dismissed by Esc or a click outside.
 *
 * There are two of these — the Content Browser from the bottom, the agent from
 * the right — and there was one implementation and a half. The second wrote the
 * scrim and the Esc key again, and got the slide and the focus handling by not
 * having them: it cut in and out rather than moving, and Tab walked out of it
 * into the panels the scrim had just made unclickable. What actually differs
 * between the two is an edge and a size, so that is what this takes.
 *
 * The shell stays MOUNTED, because a panel React has already removed has
 * nothing left to slide out with. Its CONTENT does not: it is held one
 * transition past close and then dropped, so a shut drawer costs nothing while
 * an opening one is never a jump cut.
 *
 * Deliberately not `aria-modal`: the menu bar, toolbar and status bar sit
 * OUTSIDE the scrim and stay live on purpose — the status bar is where a
 * running agent reports progress, and dimming it would hide the thing saying
 * work is happening. Focus is still kept inside, because everything the scrim
 * covers is out of reach of the pointer and should be out of reach of Tab.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDialogFocus } from '@/components/dialogFocus';

/** The panel's transform transition (--t-slow), in ms. */
const EXIT_MS = 240;

export function OverlayDrawer({ open, onClose, side, className, label, children }: {
  open: boolean;
  onClose: () => void;
  /** The edge it comes from. */
  side: 'right' | 'bottom';
  /** On the sliding panel — its size and surface, which are its own business. */
  className?: string;
  /** What it is, for anyone who cannot see the panel it opens. */
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const held = useHeldOpen(open, EXIT_MS);
  useDialogFocus(ref, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`scrim scrim--${side}${open ? ' open' : ''}`} onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={`drawer${className ? ` ${className}` : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {held && children}
      </div>
    </div>
  );
}

/** True while `open`, and for one exit transition after it goes false. */
function useHeldOpen(open: boolean, ms: number): boolean {
  const [held, setHeld] = useState(open);
  // Adjusted during render rather than from an effect, so the content is in the
  // DOM in the SAME commit that opens the drawer. From an effect it would mount
  // one paint later, and the focus seed would land on an empty shell.
  if (open && !held) setHeld(true);
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(id);
  }, [open, ms]);
  return held;
}
