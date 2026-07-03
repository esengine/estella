// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PerfRealmBridge.tsx — feeds the profiler the RIGHT engine each realm.
 *
 * The sole owner of PerfMonitor's engine source: the edit App in edit mode, and
 * the running game (play iframe) while playing — so the Profiler panel shows the
 * game's real per-system / draw-call cost during Play, not the frozen edit App.
 * One profiling surface across both realms, mirroring the Modules indicator.
 *
 * Renderless. The cross-iframe stats query is async, so it polls into a cache the
 * synchronous engine source reads (the profiler samples once per frame).
 */
import { useSyncExternalStore, useEffect } from 'react';
import { EngineHost } from '@/engine/EngineHost';
import { PlayRealm } from '@/engine/PlayRealm';
import { PerfMonitor, type EngineFrame } from '@/engine/PerfMonitor';

export function PerfRealmBridge() {
  const play = useSyncExternalStore(PlayRealm.subscribe, PlayRealm.getSnapshot);
  const inPlay = play.playing && play.ready;

  useEffect(() => {
    if (!inPlay) {
      PerfMonitor.setEngineSource(() => EngineHost.readEngineFrame(), 'edit');
      return;
    }
    // Playing: poll the running game's stats into a cache the source reads sync.
    let alive = true;
    let cache: EngineFrame | null = null;
    const poll = async () => {
      const s = await PlayRealm.stats();
      if (!alive) return;
      cache = s
        ? { phaseMs: s.phases, systemMs: s.systems, drawCalls: s.drawCalls, triangles: s.triangles, sprites: s.sprites, entities: s.entities, gpuMs: s.gpuMs }
        : null;
    };
    void poll();
    const t = setInterval(() => void poll(), 250);
    PerfMonitor.setEngineSource(() => cache, 'play');
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [inPlay]);

  return null;
}
