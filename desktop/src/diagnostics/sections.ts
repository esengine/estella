// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sections.ts
 * @brief   What core contributes to a diagnostic bundle. Registered as a side
 *          effect, like the settings and command registrations.
 *
 * @details Each section reads ONE existing source rather than restating it. The
 *          engine build stamp comes from the same manifest the boot guard reads,
 *          the counters from the same census the agent's `resource_census` tool
 *          reads, the log from the store the console renders.
 */
import { takeCensus, getDeviceIdentity, getDeviceStatus, getDeviceLostReport } from 'esengine';
import { diagnosticsRegistry } from './registry';
import { personal } from './redact';
import { timelineSnapshot } from './timeline';
import { EngineHost } from '@/engine/EngineHost';
import { checkEngineBuild } from '@/engine/EngineGuard';
import { ProjectStore } from '@/project/ProjectStore';
import { LogStore } from '@/store/LogStore';
import { settingsRegistry } from '@/settings/registry';
import { useSettings } from '@/store/settingsStore';

/**
 * The build stamp, read once at boot and held — the same reason the renderer
 * captures its identity at init. `checkEngineBuild` is a fetch, and the moment
 * this answer is wanted is the worst moment to start one.
 */
let buildStamp: unknown = null;
export function captureBuildStamp(): void {
    void checkEngineBuild().then((guard) => {
        buildStamp = guard.manifest
            ? { ...guard.manifest, guard: guard.level, guardMessage: guard.message }
            : { guard: guard.level, guardMessage: guard.message };
    }).catch(() => { /* an unreadable manifest is itself reported by the guard */ });
}

/** Filled once at boot — `getVersion` is async and a crash is a bad time to await. */
let appVersion: string | null = null;
export function captureAppVersion(): void {
    void window.estella?.getVersion?.().then((v: string) => { appVersion = v; }).catch(() => {});
}

diagnosticsRegistry.register({
    id: 'editor',
    collect: () => ({
        version: appVersion,
        platform: window.estella?.platform ?? null,
        locale: navigator.language,
        userAgent: navigator.userAgent,
        screen: { w: window.screen?.width ?? 0, h: window.screen?.height ?? 0, dpr: window.devicePixelRatio },
        uptimeSec: Math.round(performance.now() / 1000),
    }),
});

diagnosticsRegistry.register({
    id: 'engine',
    collect: () => ({
        build: buildStamp,
        backend: EngineHost.activeBackend,
        colorSpace: EngineHost.activeColorSpace,
        booted: EngineHost.app !== null,
    }),
});

/**
 * The GPU, as the driver names itself. Not personal: it identifies the machine's
 * hardware, which is the point, and says nothing about the project.
 *
 * `lostReport` is empty on a healthy session — its presence in a bundle is the
 * finding, not a field to fill in.
 */
diagnosticsRegistry.register({
    id: 'gpu',
    collect: () => {
        const id = getDeviceIdentity();
        if (!id) return null;
        const lost = getDeviceLostReport();
        return { ...id, status: getDeviceStatus(), ...(lost ? { lostReport: lost } : {}) };
    },
});

/**
 * The project, in the shape a reproduction needs: which scene, how big, how dirty.
 *
 * Names and paths are the user's, so they travel as placeholders unless the
 * export is asked for the full thing.
 */
diagnosticsRegistry.register({
    id: 'project',
    collect: () => {
        const p = ProjectStore.getSnapshot();
        if (!p) return null;
        return {
            name: personal(p.name, 'project'),
            currentScene: p.currentScene ? personal(p.currentScene, 'path') : null,
            prefabEdit: p.prefabEdit ? personal(p.prefabEdit, 'path') : null,
            defaultScene: p.defaultScene ? personal(p.defaultScene, 'path') : null,
        };
    },
});

/**
 * The counters, from the census the engine already publishes — including its own
 * `failedProbes`, because a counter that is ABSENT and one that is zero are
 * different facts and a bundle that conflated them would be read wrong.
 */
diagnosticsRegistry.register({
    id: 'census',
    collect: () => {
        const app = EngineHost.app;
        if (!app) return null;
        const c = takeCensus({ app });
        const counters: Record<string, { value: number; tier: string; unit: string }> = {};
        for (const [key, e] of c.entries) counters[key] = { value: e.value, tier: e.tier, unit: e.unit };
        return { atMs: c.atMs, counters, failedProbes: c.failedProbes };
    },
});

/**
 * The tail of the console. Messages are the user's — they interpolate asset
 * paths and entity names — so the text is personal while the level, source and
 * ordering are not: "12 errors from the asset loader" survives redaction, which
 * is most of what a first look needs.
 */
const LOG_TAIL = 200;

diagnosticsRegistry.register({
    id: 'log',
    collect: () => {
        const all = LogStore.getSnapshot();
        const tail = all.slice(-LOG_TAIL);
        return {
            total: all.length,
            shown: tail.length,
            entries: tail.map((e) => ({
                level: e.level,
                time: e.time,
                source: e.source,
                message: personal(e.message, 'text'),
            })),
        };
    },
});

/**
 * The run-up: what the editor was asked to do, newest last.
 *
 * Kept in the clear. Every entry is an id or a shape by construction (see
 * timeline.ts), so there is nothing here to redact — and a timeline of
 * placeholders would answer none of the questions a timeline is for.
 */
diagnosticsRegistry.register({
    id: 'timeline',
    collect: () => {
        const t = timelineSnapshot(Date.now());
        return t.kept > 0 ? t : null;
    },
});

/**
 * Settings that differ from their default — the ones that can change behaviour,
 * and a short list rather than the whole page. A value can be anything a project
 * put there, so values are personal while the ids are not.
 */
diagnosticsRegistry.register({
    id: 'settings',
    collect: () => {
        const changed: Record<string, unknown> = {};
        const store = useSettings.getState();
        for (const s of settingsRegistry.all()) {
            if (!store.isChanged(s.id)) continue;
            changed[s.id] = personal(store.getValue(s.id), 'value');
        }
        return Object.keys(changed).length > 0 ? changed : null;
    },
});
