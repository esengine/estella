// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fxPreview.ts
 * @brief   Applies the editor's FX-preview toggle to the live engine: flips the
 *          SDK's edit-preview flag (which unfreezes the particle + trail sims in
 *          edit mode) and restarts every effect so both edges are clean —
 *          enabling replays from t=0, disabling clears residue instead of
 *          freezing particles mid-air / stranding trail streaks. Also wires the
 *          Details-edit glue: editing a cycle-timing emitter field restarts that
 *          emitter, because those fields only manifest at cycle start (everything
 *          else — rate, colors, shape — already applies live to the running sim).
 */
import { setFxEditPreview, Particle, ParticleEmitter, Trail, TrailRenderer } from 'esengine';
import { EngineHost } from './EngineHost';
import { SceneCommands } from './SceneCommands';
import { SceneModel } from './SceneModel';
import { useEditorStore } from '@/store/editorStore';

export function applyFxPreview(enabled: boolean): void {
    setFxEditPreview(enabled);
    const world = EngineHost.world;
    if (!world) return;
    const particle = EngineHost.getResource(Particle);
    if (particle) {
        for (const e of world.getEntitiesWithComponents([ParticleEmitter])) {
            particle.reset(e);
            // reset() lowers the playing flag and the lazy first-update auto-play
            // was already consumed, so a playOnStart emitter is re-kicked by hand.
            if (enabled && (world.get(e, ParticleEmitter) as { playOnStart?: boolean }).playOnStart) {
                particle.play(e);
            }
        }
    }
    const trail = EngineHost.getResource(Trail);
    if (trail) {
        for (const e of world.getEntitiesWithComponents([TrailRenderer])) {
            trail.clear(e);
        }
    }
}

// Emitter fields that only manifest when a cycle starts — a live sim shows an
// edit to them only after a restart. Everything else applies continuously.
const CYCLE_TIMING_FIELDS = new Set(['duration', 'looping', 'playOnStart', 'burstCount', 'burstInterval']);

/** Wire the Details-edit → emitter-restart glue (call once at editor boot). */
export function initFxPreviewEditRestart(): void {
    SceneCommands.addEditHook((sourceId, compName, key) => {
        if (compName === 'ParticleEmitter' && CYCLE_TIMING_FIELDS.has(key)
            && useEditorStore.getState().previewFx) {
            // The hook fires BEFORE the write lands; restart after it has, so
            // the replay runs with the edited value (playOnStart included).
            queueMicrotask(() => restartEmitter(sourceId));
        }
        return false; // observe-only
    });
}

function restartEmitter(sourceId: number): void {
    const rt = SceneModel.runtimeFor(sourceId);
    const world = EngineHost.world;
    const particle = EngineHost.getResource(Particle);
    if (rt == null || !world || !particle || !world.has(rt, ParticleEmitter)) return;
    particle.reset(rt);
    if ((world.get(rt, ParticleEmitter) as { playOnStart?: boolean }).playOnStart) {
        particle.play(rt);
    }
}
