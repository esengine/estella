// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { worldUnitScale } from '../ecs/worldUnits';
import { Material } from '../render/material';
import { Renderer, deviceGeneration } from '../render/renderer';
import { RenderTexture, type RenderTextureHandle } from '../render/renderTexture';
import { getResourceManager } from '../wasm/resourceManager';
import { WATER_CAUSTIC_BAKE } from './waterShader';
import { CAUSTIC_PROJECTION } from './causticProjection';
import { CAUSTIC_ATLAS_SIDE, CAUSTIC_SLICES, DEFAULT_CAUSTIC_STRENGTH } from '../render/waterCaustics';

export interface OpticalField {
    /** Same frame's packed normal and elevation before forward projection. */
    surfaceTexture?: number;
    texture: number;
    rect: { x: number; y: number; z: number; w: number };
    elevation: { x: number; y: number; z: number; w: number };
}

export interface CausticBodies {
    texture: number;
    rect: OpticalField['rect'];
    ocean: OpticalField['rect'];
}

/** The source and the receiver atlas are successive graph passes for the same frame.
 * Both views and the volume march sample the very same finished set of world-space light moments. */
export class WaterOpticalField {
    private source?: RenderTextureHandle;
    private target = 0;
    private texture = 0;
    private bake = 0;
    private projection = 0;
    private material = 0;
    private ticket = 0;
    private bodyTexture = 0;
    private generation = -1;
    private size = 0;
    private ready = false;
    private failed = false;

    update(surface: number, size: number, eyeX: number, eyeZ: number, span: number,
           low: number, heightRange: number, level: number, depthStep: number, time: number, bodies?: CausticBodies | null, farContrast = 1.24): OpticalField | null {
        size = size > 0 ? Math.min(512, Math.max(CAUSTIC_ATLAS_SIDE, Math.round(size / CAUSTIC_ATLAS_SIDE) * CAUSTIC_ATLAS_SIDE)) : 0;
        const generation = deviceGeneration();
        if (size !== this.size || generation !== this.generation) {
            this.release();
            this.size = size;
            this.generation = generation;
        }
        if (!size || this.failed) return null;
        if (!this.source) {
            this.bake = Material.compileShader(WATER_CAUSTIC_BAKE);
            this.projection = Material.compileShader(CAUSTIC_PROJECTION);
            this.source = RenderTexture.create({ width: size, height: size, depth: false, filter: 'linear', floatColor: true });
            this.target = Renderer.createRenderTarget(size * 3, size, 2 | 8);
            const id = this.target && Renderer.getTargetTexture(this.target);
            this.texture = id ? getResourceManager()?.wrapDeviceTexture?.(id, size * 3, size) ?? 0 : 0;
            if (!this.bake || !this.projection || !this.source.texture || !this.texture) { this.failed = true; return null; }
            this.material = Material.create({ shader: this.projection });
            Material.setUniform(this.material, 'u_surface', Material.tex(this.source.texture));
        }
        if (this.ticket) {
            const state = Renderer.bakeState(this.ticket);
            if (state < 0) { this.failed = true; return null; }
            if (!state) return null;
            this.ready = true;
        }
        const step = span / size;
        const x = Math.floor(eyeX / step - size / 2) * step;
        const z = Math.floor(eyeZ / step - size / 2) * step;
        const rect = { x, y: z, z: span, w: step };
        const elevation = { x: low, y: heightRange, z: level, w: depthStep };
        Material.setUniform(this.material, 'u_window', { x, y: z, z: span, w: size });
        Material.setUniform(this.material, 'u_levels', elevation);
        // The copy of the receiver depth also records whether the point is submerged and
        // the effective strength there. Read live material overrides, including a zero gain.
        const uniforms = Material.getUniforms(surface);
        Material.setUniform(this.material, 'u_causticStrength', uniforms.get('u_causticStrength') ?? DEFAULT_CAUSTIC_STRENGTH);
        Material.setUniform(this.material, 'u_absorption', uniforms.get('u_absorption') ?? { x: 0.45, y: 0.09, z: 0.05, w: 1 });
        Material.setUniform(this.material, 'u_density', uniforms.get('u_density') ?? 0.0012 / worldUnitScale());
        Material.setUniform(this.material, 'u_causticBodyOcean', bodies?.ocean ?? { x: 0, y: 0, z: 4, w: 0 });
        // Read by the renderer, not by this shader: how strongly the receivers past the window take the procedural pattern.
        Material.setUniform(this.material, 'u_farContrast', farContrast);
        if (bodies) Material.setUniform(this.material, 'u_causticBodyRect', bodies.rect);
        if (this.bodyTexture !== (bodies?.texture ?? 0)) {
            this.bodyTexture = bodies?.texture ?? 0;
            Material.setUniform(this.material, 'u_zoneSurfaceData', Material.tex(this.bodyTexture));
        }
        const volumeSize = size / CAUSTIC_ATLAS_SIDE;
        // One full-density beam per wave cell, a coarser volume, and one triangle copying receiver depths.
        const instances = size * size + volumeSize * volumeSize * CAUSTIC_SLICES + 1;
        this.ticket = Renderer.bakeMaterial(surface, this.bake, this.source.target, 0, 0, size, size,
            [x, z, span, time], [low, heightRange, level, depthStep * (CAUSTIC_SLICES - 1)]);
        if (!this.ticket || !Renderer.projectMaterialBake(this.ticket, this.material, this.target, instances)) {
            this.failed = true;
            return null;
        }
        return this.ready ? { texture: this.texture, surfaceTexture: this.source.texture, rect, elevation } : null;
    }

    release(): void {
        if (this.ticket) Renderer.bakeState(this.ticket);
        if (this.source) RenderTexture.release(this.source);
        if (this.texture) getResourceManager()?.releaseTexture(this.texture);
        if (this.target) Renderer.releaseRenderTarget(this.target);
        if (this.material) Material.release(this.material);
        if (this.projection) Material.releaseShader(this.projection);
        if (this.bake) Material.releaseShader(this.bake);
        this.source = undefined;
        this.material = this.projection = this.bake = this.target = this.texture = this.ticket = 0;
        this.bodyTexture = 0;
        this.ready = this.failed = false;
    }
}
