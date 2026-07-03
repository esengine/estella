// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WindowControls.tsx — custom minimize / maximize / close for the frameless
 *        Windows & Linux window. macOS uses its native traffic lights, so this
 *        renders nothing there. Sits at the right of the title bar and opts out of
 *        the drag region so the buttons are clickable.
 */
import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

export function WindowControls() {
  const win = window.estella?.win;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!win) return;
    void win.isMaximized().then(setMaximized);
    return win.onMaximizeChange(setMaximized);
  }, [win]);

  // macOS has native traffic lights; nothing to draw there (or without the bridge).
  if (!win || window.estella?.platform === 'darwin') return null;

  return (
    <div className="winctl">
      <button className="winctl__btn" title="Minimize" onClick={() => void win.minimize()}>
        <Minus size={15} strokeWidth={1.8} />
      </button>
      <button
        className="winctl__btn"
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <Copy size={12} strokeWidth={1.8} /> : <Square size={12} strokeWidth={1.8} />}
      </button>
      <button className="winctl__btn winctl__btn--close" title="Close" onClick={() => void win.close()}>
        <X size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}
