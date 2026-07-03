// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Perf.tsx — one React-commit instrumentation wrapper.
 *
 * `<Perf id="x">…</Perf>` reports its subtree's commit time to the profiler as
 * `react.x`, so a panel/chrome region that stalls a frame is named, not lumped
 * into an unattributed spike. Use it around each independently-committing region
 * (dock panels, menu/tool/status bars) — siblings never nest, so no double-count.
 */
import { Profiler, type ReactNode } from 'react';
import { PerfMonitor } from '@/engine/PerfMonitor';

const onCommit = (id: string, _phase: unknown, actual: number) => PerfMonitor.reactCommit(id, actual);

export function Perf({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler id={id} onRender={onCommit}>
      {children}
    </Profiler>
  );
}
