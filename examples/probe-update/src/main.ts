// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {
    addPlugin, bakeLightmap, Camera, defineSystem, Input, Light, LightProbeVolume,
    MeshChannel, MeshChannelType, Mut, Query, Res, Text, Time, Transform, unwrapLightmapUV,
    type BakeSurface,
} from 'esengine';
import type { ESEngineModule } from 'esengine/wasm';
import { ProbeStatus, ProbeOccluder } from './components';

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const resolution = [3, 1, 3] as const;
const options = { atlasSize: 64, texelsPerUnit: 4, bounces: 1, samples: 64, probeSamples: 256 };

function plane(x: number, edge: number, albedo: [number, number, number]): BakeSurface {
    const points = [[x, -edge, -edge], [x, -edge, edge], [x, edge, edge], [x, edge, -edge]];
    const vertices = new Uint8Array(4 * 24);
    const view = new DataView(vertices.buffer);
    points.forEach((point, i) => {
        point.forEach((value, k) => view.setFloat32(i * 24 + k * 4, value, true));
        view.setFloat32(i * 24 + 12, -1, true);
    });
    const mesh = unwrapLightmapUV({
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
        ],
        vertexStride: 24, vertexCount: 4, vertices, indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
        aabbMin: [x, -edge, -edge], aabbMax: [x, edge, edge],
    }).mesh;
    return { mesh, transform: identity, albedo };
}

const wall = plane(3, 2, [1, 0.3, 0.1]);
const occluder = plane(1.5, 0.75, [0.4, 0.4, 0.4]);
const coefficients = new Float32Array(9 * 27);
let reference: Float32Array = new Float32Array(coefficients.length);
const state = {
    intensity: 1, updating: false, occluded: false, dirty: [] as number[],
    completed: 0, lastSolveMs: 0, maxSolveMs: 0, referenceMs: 0,
    failedProbe: -1, failure: '', samples: [] as number[],
    cycling: false, cycleFrames: 0, budgetMs: 4, overBudget: 0, updateSamples: [] as number[],
};
const grid = { min: [-1, 0, -1] as const, max: [1, 0, 1] as const, resolution };
const lights = () => [{ kind: 'directional' as const, direction: [1, 0, 0] as const,
    color: [1, 1, 1] as const, intensity: state.intensity }];
const surfaces = () => state.occluded ? [wall, occluder] : [wall];
const error = () => Math.sqrt(coefficients.reduce((sum, value, i) =>
    sum + (value - reference[i]!) ** 2, 0) / coefficients.length);

function invalidate(): void {
    const start = performance.now();
    reference = bakeLightmap(surfaces(), lights(), { ...options, probeGrids: [grid] }).probes[0]!;
    state.referenceMs = performance.now() - start;
    state.dirty = Array.from({ length: 9 }, (_, i) => i);
    state.completed = 0;
    state.failedProbe = -1;
    state.failure = '';
}

function upload(module: ESEngineModule): number {
    if (!module.probe_volume_create) throw new Error('Probe updates are unavailable on this runtime');
    const pointer = module._malloc(coefficients.byteLength);
    if (!pointer) throw new Error('Probe allocation failed');
    try {
        module.HEAPF32.set(coefficients, pointer >> 2);
        const handle = module.probe_volume_create(3, 1, 3, pointer);
        if (!handle) throw new Error('Probe upload failed');
        return handle;
    } finally {
        module._free(pointer);
    }
}

const controls = {
    state,
    error,
    setIntensity(value: number) { state.intensity = value === 3 ? 3 : 1; invalidate(); },
    setUpdating(value: boolean) { state.updating = value; },
    setOccluded(value: boolean) { state.occluded = value; invalidate(); },
    setCycling(value: boolean) { state.cycling = value; state.cycleFrames = 0; },
};
(globalThis as typeof globalThis & { probeResearch?: typeof controls }).probeResearch = controls;

addPlugin({
    name: 'probe-update-research',
    build(app) {
        let handle = 0;
        app.addStartupSystem(defineSystem([Query(Mut(LightProbeVolume))], volumes => {
            invalidate();
            coefficients.set(reference);
            if (!app.wasmModule) { state.failure = 'This prototype needs the Web runtime'; return; }
            handle = upload(app.wasmModule);
            for (const [, volume] of volumes) volume.probes = handle;
            state.dirty = [];
        }, { name: 'ProbeResearchSetup' }));
        app.addSystem(defineSystem([
            Res(Input), Query(Mut(Light)), Query(Mut(LightProbeVolume)),
            Query(Mut(Transform), ProbeOccluder), Query(Mut(Text), ProbeStatus),
            Res(Time), Query(Mut(Transform), Camera),
        ], (input, lamps, volumes, blockers, labels, time, cameras) => {
            const updateStart = performance.now();
            if (input.isKeyPressed('KeyL')) controls.setIntensity(state.intensity === 1 ? 3 : 1);
            if (input.isKeyPressed('Space')) state.updating = !state.updating;
            if (input.isKeyPressed('KeyO')) controls.setOccluded(!state.occluded);
            if (input.isKeyPressed('KeyR')) controls.setCycling(!state.cycling);
            if (state.cycling && state.updating && ++state.cycleFrames >= 30) {
                state.cycleFrames = 0;
                controls.setIntensity(state.intensity === 1 ? 3 : 1);
            }
            for (const [, transform] of cameras) {
                const p = transform.position;
                p.x = Math.max(0, Math.min(3, p.x + time.delta * 1.5 *
                    (Number(input.isKeyDown('ArrowRight')) - Number(input.isKeyDown('ArrowLeft')))));
                p.z = Math.max(3, Math.min(6, p.z + time.delta * 1.5 *
                    (Number(input.isKeyDown('ArrowDown')) - Number(input.isKeyDown('ArrowUp')))));
            }
            for (const [, lamp] of lamps) lamp.intensity = state.intensity;
            for (const [, transform] of blockers) transform.scale = state.occluded
                ? { x: 0.001, y: 0.015, z: 0.015 } : { x: 0, y: 0, z: 0 };
            if (state.updating && state.dirty.length > 0 && !state.failure && app.wasmModule) {
                const index = state.dirty[0]!;
                const start = performance.now();
                const point = [index % 3 - 1, 0, Math.floor(index / 3) - 1] as const;
                try {
                    const fresh = bakeLightmap(surfaces(), lights(), { ...options,
                        probeGrids: [{ min: point, max: point, resolution: [1, 1, 1] }],
                    }).probes[0]!;
                    const previous = coefficients.slice(index * 27, (index + 1) * 27);
                    coefficients.set(fresh, index * 27);
                    let next: number;
                    try { next = upload(app.wasmModule); }
                    catch (failure) { coefficients.set(previous, index * 27); throw failure; }
                    for (const [, volume] of volumes) volume.probes = next;
                    app.wasmModule.probe_volume_release?.(handle);
                    handle = next;
                    state.dirty.shift();
                    state.completed++;
                } catch (failure) {
                    state.failedProbe = index;
                    state.failure = failure instanceof Error ? failure.message : String(failure);
                }
                state.lastSolveMs = performance.now() - start;
                state.maxSolveMs = Math.max(state.maxSolveMs, state.lastSolveMs);
                state.samples.push(state.lastSolveMs);
                if (state.samples.length > 256) state.samples.shift();
            }
            const updateMs = performance.now() - updateStart;
            state.updateSamples.push(updateMs);
            if (state.updateSamples.length > 256) state.updateSamples.shift();
            if (updateMs > state.budgetMs) state.overBudget++;
            for (const [, label] of labels) label.content = state.failure
                ? `Probe (${state.failedProbe % 3 - 1}, 0, ${Math.floor(state.failedProbe / 3) - 1}) failed: ${state.failure}`
                : `${state.updating ? 'Updating' : 'Static'} | ${state.completed}/9 | error ${error().toFixed(4)} | solve ${state.lastSolveMs.toFixed(2)} ms | >4ms ${state.overBudget}`;
        }, { name: 'ProbeResearchUpdate' }));
        app.addPlugin({ name: 'probe-research-lifetime', build() {},
            cleanup() { app.wasmModule?.probe_volume_release?.(handle); },
        });
    },
});
