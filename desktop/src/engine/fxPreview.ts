// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fxPreview.ts
 * @brief   Applies the editor's FX-preview toggle to the live engine: flips the
 *          SDK's edit-preview flag (which unfreezes the particle sim in edit
 *          mode) and restarts every emitter so both edges are clean — enabling
 *          replays from t=0, disabling clears residue instead of freezing
 *          particles mid-air.
 */
import { setParticleEditPreview, Particle, ParticleEmitter } from 'esengine';
import { EngineHost } from './EngineHost';

export function applyFxPreview(enabled: boolean): void {
    setParticleEditPreview(enabled);
    const world = EngineHost.world;
    const particle = EngineHost.getResource(Particle);
    if (!world || !particle) return;
    for (const e of world.getEntitiesWithComponents([ParticleEmitter])) {
        particle.reset(e);
        // reset() lowers the playing flag and the lazy first-update auto-play
        // was already consumed, so a playOnStart emitter is re-kicked by hand.
        if (enabled && (world.get(e, ParticleEmitter) as { playOnStart?: boolean }).playOnStart) {
            particle.play(e);
        }
    }
}
