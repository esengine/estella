// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pluginSets.ts
 * @brief   Which plugins make up a runtime, in one place.
 *
 * @details There are three shapes: the web app (everything), a headless one (the
 *          simulation, nothing to be seen) and a native one (everything, over the
 *          native core). They used to keep three separate lists, and a plugin added
 *          to the web stack quietly skipped the other two — which is how a device
 *          ended up running a game's logic but none of its tilemaps, particles,
 *          trails, meshes or post-process volumes.
 *
 *          So the web stack is defined here as simulation + presentation, and every
 *          factory takes the part it wants. `sdk/tests/plugin-sets.test.ts` pins the
 *          three against each other.
 *
 *          Presentation plugins reach the engine through `engineApi(app)`, so they
 *          are core-agnostic: each one runs against the wasm module or the native
 *          host's bindings, and says so when the core it got compiled its subsystem
 *          out. Internal: the factories are the public surface, not the lists.
 */
import type { Plugin } from './app';
import { animationPlugin } from '../animation';
import { audioPlugin } from '../audio';
import { videoPlugin } from '../video';
import { particlePlugin } from '../particle';
import { trailPlugin } from '../trail';
import { mesh2dPlugin } from '../render/mesh2d';
import { tilemapPlugin } from '../tilemap';
import { postProcessPlugin } from '../postprocess';
import { timelinePlugin } from '../timeline';
import { timerPlugin } from '../ecs/timer';
import { velocityPlugin } from '../velocity';
import { lifecyclePlugin } from '../ecs/lifecycle';
import { navPlugin, fsmPlugin, btPlugin, perceptionPlugin } from '../ai';
import { eventBindingPlugin } from '../eventBinding';
import { replicationPlugin } from '../net/replication';
import { servicesPlugin } from '../services';
import { diagnosticsPlugin } from '../diagnostics';

/**
 * The simulation: timers/lifecycle, gameplay AI, audio (silent on a host with no
 * device), replication, and platform services (ads/share — unavailable on a host
 * with no such surface, and gameplay code gates on `Ads.available` the same way
 * audio degrades). What an authoritative server runs.
 *
 * Diagnostics is FIRST, and that position is the point: it starts listening
 * before anything else builds, so a plugin that fails on the way up is recorded
 * rather than being the one failure the reporter was installed too late to see.
 * It sends nothing anywhere until a game installs a sink.
 */
export const simulationBasePlugins = (): Plugin[] => [
    diagnosticsPlugin,
    timerPlugin, velocityPlugin, lifecyclePlugin, audioPlugin,
    perceptionPlugin, fsmPlugin, btPlugin, navPlugin, eventBindingPlugin, replicationPlugin,
    servicesPlugin,
];

/** What exists to be seen. Every entry drives the engine through `engineApi`. */
export const presentationBasePlugins = (): Plugin[] => [
    animationPlugin, videoPlugin, particlePlugin, trailPlugin, mesh2dPlugin,
    tilemapPlugin, postProcessPlugin, timelinePlugin,
];

/**
 * The full stack, in the order the web factory has always built it (build order
 * decides resource insertion and per-schedule system order, so it is preserved
 * exactly rather than derived by concatenation).
 */
export const webBasePlugins = (): Plugin[] => [
    diagnosticsPlugin,
    timerPlugin, velocityPlugin, lifecyclePlugin, animationPlugin, audioPlugin, videoPlugin,
    particlePlugin, trailPlugin, mesh2dPlugin, tilemapPlugin, postProcessPlugin, timelinePlugin,
    perceptionPlugin, fsmPlugin, btPlugin, navPlugin, eventBindingPlugin, replicationPlugin,
    servicesPlugin,
];
