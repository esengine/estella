// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Perf.tsx — `<Perf id="x">` reports its subtree's React commit time as
 *        `react.x`. Wrap each independently-committing region (never nest siblings).
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
