// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useSyncExternalStore, useState, useRef, useEffect } from 'react';
import type { SubsystemStatus } from 'esengine';
import { EngineHost } from '@/engine/EngineHost';
import { PlayRealm } from '@/engine/PlayRealm';

// Status-bar indicator for engine subsystem (module) health. A single dot
// summarizes the worst state; clicking opens a popover that lists each module
// with its lifecycle phase and derived liveness. The data is the canonical
// EditorControlSurface "observe" read, surfaced through EngineHost's store.

type DotKind = 'ok' | 'idle' | 'busy' | 'err';

/** Map a subsystem's phase + derived activity to a dot kind and a short label. */
function present(s: SubsystemStatus): { dot: DotKind; text: string; run?: boolean } {
  if (s.phase === 'error') return { dot: 'err', text: 'error' };
  if (s.phase === 'initializing') return { dot: 'busy', text: 'loading…' };
  if (s.phase === 'registered') return { dot: 'busy', text: 'registered' };
  // ready: distinguish actively stepping vs frozen vs never-probed
  if (s.activity === 'stepping') return { dot: 'ok', text: 'running', run: true };
  if (s.activity === 'idle') return { dot: 'idle', text: 'idle' };
  return { dot: 'ok', text: 'ready' };
}

/** Worst-of summary for the trigger dot: error ▸ busy ▸ ok. */
function overall(list: SubsystemStatus[]): DotKind {
  if (list.some((s) => s.phase === 'error')) return 'err';
  if (list.some((s) => s.phase === 'initializing' || s.phase === 'registered')) return 'busy';
  return 'ok';
}

export function SubsystemIndicator() {
  const editSubsystems = useSyncExternalStore(
    EngineHost.subscribeSubsystems,
    EngineHost.getSubsystemsSnapshot,
  );
  // While playing, the real subsystems run in the play realm (iframe) — poll those so
  // the indicator reflects the running game, not the frozen edit App. One observability
  // surface across both realms.
  const play = useSyncExternalStore(PlayRealm.subscribe, PlayRealm.getSnapshot);
  const [playSubsystems, setPlaySubsystems] = useState<SubsystemStatus[]>([]);
  useEffect(() => {
    if (!play.playing || !play.ready) { setPlaySubsystems([]); return; }
    let alive = true;
    const poll = async () => {
      const s = await PlayRealm.subsystems();
      if (alive && s) setPlaySubsystems(s);
    };
    void poll();
    const t = setInterval(() => void poll(), 500);
    return () => { alive = false; clearInterval(t); };
  }, [play.playing, play.ready]);

  const inPlay = play.playing && playSubsystems.length > 0;
  const subsystems = inPlay ? playSubsystems : editSubsystems;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const dot = overall(subsystems);

  return (
    <div className="mods-wrap" ref={wrapRef}>
      <button
        type="button"
        className="sitem click"
        title="Engine modules"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`mdot ${dot}`} />
        Modules
      </button>
      {open && (
        <div className="mods-pop" role="menu">
          <h4>Engine Modules{inPlay ? ' · Play' : ''}</h4>
          {subsystems.length === 0 ? (
            <div className="mods-empty">Engine not booted</div>
          ) : (
            subsystems.map((s) => {
              const p = present(s);
              return (
                <div key={s.id} className="mods-block">
                  <div className="mods-row">
                    <span className={`mdot ${p.dot}`} />
                    <span className="mn">{s.displayName}</span>
                    <span className={`ms${p.dot === 'err' ? ' err' : p.run ? ' run' : ''}`}>
                      {p.text}
                    </span>
                  </div>
                  {s.phase === 'error' && s.lastError && (
                    <div className="mods-err">{s.lastError}</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
