// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DiagnosticsPlugin.ts
 * @brief   Installs the diagnostics resource and subscribes it to everything
 *          that already knew something had gone wrong.
 *
 * Nothing here is a NEW error channel. The engine has had four for a long time
 * — `app.onError`, `app.onSystemError`, `app.onWasmError`, and the logger — and
 * a fifth would just be a fifth place to remember to look. Three of those are
 * single-slot setters that belong to the GAME: taking one would silently
 * replace whatever the developer had installed, which is a bad trade for a
 * feature whose whole promise is that it does not get in the way.
 *
 * The logger is the one that was already right for this. It has always been a
 * broadcast (`addHandler`), every error the engine raises goes through it —
 * including the system-threw path, which logs before it consults either
 * handler — and adding a listener takes nothing away from anyone. So the bridge
 * is a `LogHandler`, and the game's own error handlers keep working exactly as
 * they did.
 *
 * That leaves the failures that never reach a log because they happen outside
 * the frame, which is why the platform grew three optional subscriptions:
 * uncaught host errors, a lost render context, and OS memory pressure. Each is
 * absent on the platforms that cannot signal it, and absent is fine — what is
 * collected degrades, the API does not.
 *
 * Flushing is driven by a system rather than a timer. A backgrounded tab or a
 * suspended mini-game stops stepping, and a diagnostics batch that kept firing
 * into a frozen host would be reporting from a game that is not running.
 */
import type { App, Plugin } from '../app/app';
import { Schedule, defineSystem } from '../ecs/system';
import { Time } from '../core-runtime';
import { log, LogLevel, type LogEntry, type LogHandler } from '../util/logger';
import {
    platformOnContextLost, platformOnMemoryWarning, platformOnUnhandledError,
} from '../platform';
import { Diagnostics, DiagnosticsAPI, type DiagnosticsOptions } from './Diagnostics';

export interface DiagnosticsPluginOptions extends DiagnosticsOptions {
    /**
     * The lowest log level to collect. `Error` by default — a warning is
     * something the engine handled, and a report full of them buries the one
     * line that says a texture never loaded. `Warn` is the useful widening when
     * chasing a specific complaint.
     */
    captureLevel?: LogLevel;
}

/** Bridges the engine's log broadcast into the diagnostics aggregator. */
class DiagnosticsLogHandler implements LogHandler {
    constructor(
        private readonly api_: DiagnosticsAPI,
        private readonly minLevel_: LogLevel,
    ) {}

    handle(entry: LogEntry): void {
        if (entry.level < this.minLevel_) return;
        this.api_.report({
            kind: 'engine',
            message: entry.message,
            source: entry.category,
            error: entry.data,
        });
    }
}

export class DiagnosticsPlugin implements Plugin {
    name = 'Diagnostics';

    private unsubscribes_: (() => void)[] = [];
    private handler_: DiagnosticsLogHandler | null = null;

    constructor(private readonly options_: DiagnosticsPluginOptions = {}) {}

    build(app: App): void {
        const api = new DiagnosticsAPI(this.options_);
        app.insertResource(Diagnostics, api);

        this.handler_ = new DiagnosticsLogHandler(api, this.options_.captureLevel ?? LogLevel.Error);
        log.addHandler(this.handler_);

        this.unsubscribes_.push(
            platformOnUnhandledError((error) => api.reportError('unhandled', error)),
            // No error object and nothing to name: what matters is that it
            // happened, and when. The frames after it draw nothing.
            platformOnContextLost(() => api.report({
                kind: 'context-lost',
                message: 'The rendering context was lost',
            })),
            // Reported rather than acted on — the residency caches already
            // subscribe to this and trim themselves. What this adds is the
            // record, because the process being killed a moment later is the
            // crash that never gets a report of its own.
            platformOnMemoryWarning(() => api.report({
                kind: 'memory',
                message: 'The host warned that memory is running low',
            })),
        );

        app.addSystemToSchedule(Schedule.Last, defineSystem(
            [],
            () => {
                const time = app.getResource(Time);
                app.getResource(Diagnostics)?.tick(time?.delta ?? 0);
            },
            { name: 'DiagnosticsFlush' },
        ));
    }

    cleanup(app: App): void {
        for (const unsubscribe of this.unsubscribes_) {
            try {
                unsubscribe();
            } catch { /* a host that cannot unsubscribe is not worth failing shutdown over */ }
        }
        this.unsubscribes_ = [];
        if (this.handler_) {
            log.removeHandler(this.handler_);
            this.handler_ = null;
        }
        // Last chance to deliver: a game closing is exactly when the report of
        // why it closed is worth having.
        app.getResource(Diagnostics)?.flush();
    }
}

export const diagnosticsPlugin = new DiagnosticsPlugin();
