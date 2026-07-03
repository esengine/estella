// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PerfOverlay.tsx — the frame-timing readout (View ▸ Perf).
 *
 * A leaf that subscribes to PerfMonitor so its twice-a-second updates never
 * re-render the viewport. Shows p50/p95/p99 frame time, dropped-frame count,
 * the worst frame + its dominant phase, and any long task (GC / long JS).
 */
import { useSyncExternalStore } from 'react';
import { PerfMonitor } from '@/engine/PerfMonitor';

export function PerfOverlay() {
  const s = useSyncExternalStore(PerfMonitor.subscribe, PerfMonitor.getSnapshot);
  const warn = 'var(--warn, #e5a33b)';
  const p99Bad = s.p99 >= 24;
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 60,
        pointerEvents: 'none',
        font: '11px var(--font-mono, ui-monospace, monospace)',
        lineHeight: 1.55,
        color: 'var(--text-dim, #cfcfcf)',
        background: 'var(--srf-3, #17171b)',
        border: '1px solid var(--border-line, #333)',
        borderRadius: 6,
        padding: '6px 9px',
        boxShadow: 'var(--shadow-3, 0 6px 18px rgba(0,0,0,0.4))',
      }}
    >
      <div>
        <span style={{ color: 'var(--text-mute, #888)' }}>fps</span> <b>{s.fps}</b>
        {'  ·  p50 '}{s.p50}{'  p95 '}{s.p95}{'  '}
        <span style={{ color: p99Bad ? warn : 'inherit' }}>p99 {s.p99}ms</span>
      </div>
      <div>
        <span style={{ color: 'var(--text-mute, #888)' }}>long frames</span> <b>{s.longFrames}</b>
        {s.worstMs > 0 ? (
          <>
            {'  ·  worst '}{s.worstMs}ms{' '}
            <span style={{ color: 'var(--text-mute, #888)' }}>({s.worstPhase ?? 'other'})</span>
          </>
        ) : null}
      </div>
      {s.longTaskMs > 0 ? (
        <div style={{ color: warn }}>long task {s.longTaskMs}ms · GC / long JS</div>
      ) : null}
    </div>
  );
}
