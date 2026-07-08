// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { PlayRealm, PlayRealms } from '@/engine/PlayRealm';
import { useEditorStore } from '@/store/editorStore';

// The "Game" dock panel: hosts the isolated play-realm iframe (the realm owns the
// element + re-parents it here, so the realm survives panel remounts). The host
// div has NO React children — the realm appends the iframe into it manually — so a
// status overlay is a separate absolutely-positioned sibling.

function overlayFor(snap: { playing: boolean; ready: boolean; error: string | null }): string | null {
  return snap.error
    ? `Play failed: ${snap.error}`
    : !snap.playing
      ? 'Press Play to run the game.'
      : !snap.ready
        ? 'Starting…'
        : null;
}

export function GamePanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const snap = useSyncExternalStore(PlayRealm.subscribe, PlayRealm.getSnapshot);
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

  const overlay = overlayFor(snap);
  return (
    <div className="game-panel">
      <div className="game-panel__host" ref={hostRef} />
      {overlay && <div className={`game-panel__overlay${snap.error ? ' error' : ''}`}>{overlay}</div>}
    </div>
  );
}

const NO_SNAPSHOT = (): null => null;

/** A multiplayer client realm's panel ("Game P2..N"). The realm instance is
 *  session-scoped, so the panel re-attaches whenever the session epoch bumps —
 *  a code reload restarts the whole session with fresh instances behind the
 *  same panel. */
export function GameClientPanel({ realmId }: { realmId: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const session = useSyncExternalStore(PlayRealms.subscribeSession, PlayRealms.getSessionSnapshot);
  const realm = PlayRealms.get(realmId);

  useEffect(() => {
    const el = hostRef.current;
    const live = PlayRealms.get(realmId);
    if (el && live) live.attach(el);
    return () => live?.detach();
  }, [realmId, session.epoch]);

  // A missing realm (stale restored layout, stopped session) renders idle.
  const snap = useSyncExternalStore(
    realm ? realm.subscribe : PlayRealms.subscribeSession,
    realm ? realm.getSnapshot : NO_SNAPSHOT,
  );

  const overlay = snap ? overlayFor(snap) : 'No multiplayer session.';
  return (
    <div className="game-panel">
      <div className="game-panel__host" ref={hostRef} />
      {overlay && <div className={`game-panel__overlay${snap?.error ? ' error' : ''}`}>{overlay}</div>}
    </div>
  );
}
