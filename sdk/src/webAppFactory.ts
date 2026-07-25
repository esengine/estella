// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { App, createWebApp as _createWebApp, type Plugin, type WebAppOptions } from './app';
import type { CppRegistry, ESEngineModule } from './wasm';
import { assetPlugin } from './asset';
import { prefabsPlugin } from './prefabServer';
import { sceneManagerPlugin } from './scenePlugin';
import { seedEngineComponents } from './component';
import { uiPlugins } from './uiPlugins';
import { simulationBasePlugins, webBasePlugins } from './pluginSets';
import { SpinePlugin } from './spine';
import { createFetchSideModuleHost, type SideModuleHost } from './sideModules';


export interface CreateWebAppOptions extends WebAppOptions {
    /**
     * Convenience for the fetch realms (editor / web / desktop): the base URL the
     * side-module artifacts (physics.wasm, spine38.js/.wasm, …) are served from —
     * usually the same directory as esengine.wasm. Builds a fetch {@link SideModuleHost}
     * when no explicit `sideModules` is given. Realms that inline their modules
     * (playable / WeChat) pass `sideModules` directly instead.
     */
    wasmBaseUrl?: string;
}

// Simulation + presentation, in build order (see pluginSets.ts — one definition,
// so the headless and native factories cannot drift from this one).
const basePlugins = webBasePlugins();

export function createWebApp(module: ESEngineModule, options?: CreateWebAppOptions): App {
    const sideModules: SideModuleHost | undefined = options?.sideModules
        ?? (options?.wasmBaseUrl ? createFetchSideModuleHost(options.wasmBaseUrl) : undefined);
    // SpinePlugin builds its per-version SpineManager from app.sideModules in build().
    const spinePlugin = new SpinePlugin();
    const plugins = [...uiPlugins, ...basePlugins, spinePlugin, ...(options?.plugins ?? [])];
    return _createWebApp(module, { ...options, sideModules, plugins });
}

export interface HeadlessAppOptions {
    plugins?: Plugin[];
    /** Optional-native-module acquirer (physics on the server). */
    sideModules?: SideModuleHost;
}

/** The simulation stack with no presentation: timers/lifecycle, gameplay AI, audio
 *  (silent on a host with no device) and replication. Presentation plugins exist to
 *  be seen, so a headless app leaves them out — see pluginSets.ts. */
export const headlessBasePlugins = (): Plugin[] => simulationBasePlugins();

/**
 * An App with the full simulation stack and no presentation: no renderer, no
 * render pipeline, no input device, no UI. This is the authoritative-server
 * shape (same wasm module, same gameplay code, same fixed-tick loop) — also
 * useful for workers and tests. Drive it with {@link runHeadless} or
 * `app.tick(dt)`.
 *
 * @beta Pre-1.0: the headless asset story (gameplay data without textures)
 * is still settling and may change this factory's options.
 */
export function createHeadlessApp(module: ESEngineModule, options?: HeadlessAppOptions): App {
    seedEngineComponents();
    const app = App.new();
    if (options?.sideModules) app.setSideModules(options.sideModules);
    const cppRegistry = new module.Registry() as unknown as CppRegistry;
    app.connectCpp(cppRegistry, module, { strict: true });

    // No corePlugin: it wires the render facades (ResourceManager, draw,
    // material, post-process) that only exist after initRenderer().
    app.addPlugin(assetPlugin);
    app.addPlugin(prefabsPlugin);
    app.addPlugin(sceneManagerPlugin);
    app.addPlugins(headlessBasePlugins());
    if (options?.plugins) app.addPlugins(options.plugins);
    return app;
}

/**
 * Drive an app on a wall-clock interval (no requestAnimationFrame on a
 * server). Delta is measured, so the fixed-step accumulator keeps simulation
 * cadence exact across timer jitter. Returns a stop function.
 *
 * @beta Pre-1.0: paired with {@link createHeadlessApp}, evolves with it.
 */
export function runHeadless(app: App, options?: { fps?: number }): () => void {
    const intervalMs = 1000 / (options?.fps ?? 60);
    let last = Date.now();
    let ticking = false;
    const timer = setInterval(() => {
        if (ticking) return; // a slow async tick must not pile up re-entrantly
        const now = Date.now();
        const delta = (now - last) / 1000;
        last = now;
        ticking = true;
        void app.tick(delta).finally(() => { ticking = false; });
    }, intervalMs);
    return () => clearInterval(timer);
}
