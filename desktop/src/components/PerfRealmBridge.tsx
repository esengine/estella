// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PerfRealmBridge.tsx — routes PerfMonitor's engine source to the edit App
 *        or, while playing, the play iframe (polled into a cache read synchronously).
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
        ? { phaseMs: s.phases, systemMs: s.systems, drawCalls: s.drawCalls, triangles: s.triangles, sprites: s.sprites, entities: s.entities, gpuMs: s.gpuMs, cppScopes: s.cppScopes, wasmBytes: s.wasmBytes, vramBytes: s.vramBytes }
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
