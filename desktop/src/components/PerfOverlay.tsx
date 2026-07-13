// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PerfOverlay.tsx — a tiny fps glance in the viewport corner; the detail
 *        lives in the dockable Profiler panel. Leaf subscriber (no viewport re-render).
 */
import { useSyncExternalStore } from 'react';
import { t } from '@/i18n';
import { PerfMonitor } from '@/engine/PerfMonitor';

const mute = 'var(--text-mute)';

export function PerfOverlay() {
  const s = useSyncExternalStore(PerfMonitor.subscribe, PerfMonitor.getSnapshot);
  const warn = 'var(--warn)';
  const p99Bad = s.p99 >= 24;
  return (
    <div
      style={{
        // Bottom-right, above the FPS HUD (.vp-perf) — telemetry grouped together
        // and clear of the interactive tool clusters in the top corners.
        position: 'absolute',
        bottom: 88,
        right: 10,
        zIndex: 4,
        pointerEvents: 'none',
        font: 'var(--fs-xs) var(--mono)',
        lineHeight: 1.55,
        color: 'var(--text-dim)',
        background: 'rgba(var(--glass-rgb), 0.72)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid var(--border-line)',
        borderRadius: 'var(--r-lg)',
        padding: '7px 9px',
        boxShadow: 'var(--shadow-2)',
      }}
    >
      <div>
        <span style={{ color: mute }}>fps</span> <b>{s.fps}</b>
        {'  ·  p50 '}{s.p50}{'  p95 '}{s.p95}{'  '}
        <span style={{ color: p99Bad ? warn : 'inherit' }}>p99 {s.p99}ms</span>
      </div>
      {s.longFrames > 0 || s.longTaskMs > 0 ? (
        <div>
          <span style={{ color: mute }}>{t('vp.perfLongFrames')}</span> <b>{s.longFrames}</b>
          {s.longTaskMs > 0 ? <span style={{ color: warn }}>{'  ·  '}{t('vp.perfTask')}{' '}{s.longTaskMs}ms</span> : null}
        </div>
      ) : null}
    </div>
  );
}
