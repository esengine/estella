import { useEffect, useRef, useSyncExternalStore } from 'react';
import { PlayRealm } from '@/engine/PlayRealm';

// The "Game" dock panel: hosts the isolated play-realm iframe (PlayRealm owns the
// element + re-parents it here, so the realm survives panel remounts). The host
// div has NO React children — PlayRealm appends the iframe into it manually — so a
// status overlay is a separate absolutely-positioned sibling.
export function GamePanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const { playing, ready, error } = useSyncExternalStore(PlayRealm.subscribe, PlayRealm.getSnapshot);

  useEffect(() => {
    const el = hostRef.current;
    if (el) PlayRealm.attach(el);
    return () => PlayRealm.detach();
  }, []);

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
