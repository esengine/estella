// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { PlayRealm } from '@/engine/PlayRealm';
import { useEditorStore } from '@/store/editorStore';

// The "Game" dock panel: hosts the isolated play-realm iframe (PlayRealm owns the
// element + re-parents it here, so the realm survives panel remounts). The host
// div has NO React children — PlayRealm appends the iframe into it manually — so a
// status overlay is a separate absolutely-positioned sibling.
export function GamePanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const { playing, ready, error } = useSyncExternalStore(PlayRealm.subscribe, PlayRealm.getSnapshot);
  const playTarget = useEditorStore((s) => s.playTarget);

  // Only host the realm iframe in 'window' mode — in 'viewport' mode the Viewport
  // owns it (one iframe, one mount). Guards against a stale Game tab stealing it.
  useEffect(() => {
    const el = hostRef.current;
    if (el && playTarget === 'window') PlayRealm.attach(el);
    return () => {
      if (playTarget === 'window') PlayRealm.detach();
    };
  }, [playTarget]);

  const overlay = error
    ? `Play failed: ${error}`
    : !playing
      ? 'Press Play to run the game.'
      : !ready
        ? 'Starting…'
        : null;

  return (
    <div className="game-panel">
      <div className="game-panel__host" ref={hostRef} />
      {overlay && <div className={`game-panel__overlay${error ? ' error' : ''}`}>{overlay}</div>}
    </div>
  );
}
