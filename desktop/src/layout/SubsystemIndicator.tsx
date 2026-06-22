import { useSyncExternalStore, useState, useRef, useEffect } from 'react';
import type { SubsystemStatus } from 'esengine';
import { EngineHost } from '@/engine/EngineHost';

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
  const subsystems = useSyncExternalStore(
    EngineHost.subscribeSubsystems,
    EngineHost.getSubsystemsSnapshot,
  );
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
          <h4>Engine Modules</h4>
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
