// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { App, type Plugin } from '../src/app/app';
import { Schedule, defineSystem, defineSystemSet } from '../src/ecs/system';
import { DOMAIN_SCRIPTS, DOMAIN_UNATTRIBUTED, buildFrameProfile } from '../src/app/frameProfile';

function domainOf(app: App, systemName: string): string | undefined {
    return app.getFrameCosts()?.systems.find((s) => s.name === systemName)?.domain;
}

function pluginAdding(name: string, systemName: string, extra?: Partial<Plugin>): Plugin {
    return {
        name,
        ...extra,
        build(app) {
            app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: systemName }));
        },
    };
}

describe('App.getFrameCosts', () => {
    it('is null until stats are enabled', async () => {
        const app = App.new();
        await app.tick(1 / 60);
        expect(app.getFrameCosts()).toBeNull();
    });

    it('files the systems of a plugin under the plugin name', async () => {
        const app = App.new().enableStats();
        app.addPlugin(pluginAdding('physics', 'PhysicsStep'));
        await app.tick(1 / 60);

        expect(domainOf(app, 'PhysicsStep')).toBe('physics');
    });

    it('files them under profileDomain where a plugin declares one', async () => {
        const app = App.new().enableStats();
        app.addPlugin(pluginAdding('camera', 'RenderSystem', { profileDomain: 'render' }));
        await app.tick(1 / 60);

        expect(domainOf(app, 'RenderSystem')).toBe('render');
    });

    it('files project systems under scripts', async () => {
        const app = App.new().enableStats();
        app.addBundleSystems([
            { schedule: Schedule.Update, system: defineSystem([], () => {}, { name: 'EnemyAI' }) },
        ]);
        await app.tick(1 / 60);

        expect(domainOf(app, 'EnemyAI')).toBe(DOMAIN_SCRIPTS);
    });

    it('files a project system SET under scripts too', async () => {
        const app = App.new().enableStats();
        app.addBundleSystems([
            {
                schedule: Schedule.Update,
                system: defineSystemSet('ai', {
                    systems: [defineSystem([], () => {}, { name: 'EnemyAI' })],
                }),
            },
        ]);
        await app.tick(1 / 60);

        expect(domainOf(app, 'EnemyAI')).toBe(DOMAIN_SCRIPTS);
    });

    it('says so rather than guessing when a system came through neither door', async () => {
        const app = App.new().enableStats();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'Loose' }));
        await app.tick(1 / 60);

        expect(domainOf(app, 'Loose')).toBe(DOMAIN_UNATTRIBUTED);
    });

    it('restores the outer domain after a nested plugin build', async () => {
        const inner = pluginAdding('audio', 'AudioUpdate');
        const outer: Plugin = {
            name: 'camera',
            profileDomain: 'render',
            build(app) {
                app.addPlugin(inner);
                app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'RenderSystem' }));
            },
        };
        const app = App.new().enableStats();
        app.addPlugin(outer);
        await app.tick(1 / 60);

        expect(domainOf(app, 'AudioUpdate')).toBe('audio');
        expect(domainOf(app, 'RenderSystem')).toBe('render');
    });
});

describe('measureFrameScope attribution', () => {
    it('files a scope under the system it was opened inside', async () => {
        const app = App.new().enableStats();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            app.measureFrameScope('render.submit', () => {});
        }, { name: 'RenderSystem' }));
        await app.tick(1 / 60);

        const scope = app.getFrameCosts()?.scopes.find((s) => s.name === 'render.submit');
        expect(scope?.system).toBe('RenderSystem');
        expect(scope?.remainder).toBe('work');
    });

    it('leaves a scope opened outside every system unattributed', async () => {
        const app = App.new().enableStats();
        await app.tick(1 / 60);
        app.measureFrameScope('boot.warmup', () => {});

        expect(app.getFrameCosts()?.scopes.find((s) => s.name === 'boot.warmup')?.system).toBe('');
    });

    it('does not leak the last system onto a scope opened after the schedule', async () => {
        const app = App.new().enableStats();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'RenderSystem' }));
        await app.tick(1 / 60);
        app.measureFrameScope('after.frame', () => {});

        expect(app.getFrameCosts()?.scopes.find((s) => s.name === 'after.frame')?.system).toBe('');
    });

    it('carries the declared remainder through to the profile', async () => {
        const app = App.new().enableStats();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            app.measureFrameScope('render.submit', () => {}, { remainder: 'wait' });
        }, { name: 'RenderSystem' }));
        await app.tick(1 / 60);

        const costs = app.getFrameCosts()!;
        expect(costs.scopes.find((s) => s.name === 'render.submit')?.remainder).toBe('wait');
        const profile = buildFrameProfile({ frameMs: 16.7, ...costs });
        expect(profile.cpuMs + profile.waitMs + profile.idleMs).toBeCloseTo(profile.frameMs, 4);
    });

    it('accumulates a repeated scope name without losing its system', async () => {
        const app = App.new().enableStats();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            app.measureFrameScope('ui.layout', () => {});
            app.measureFrameScope('ui.layout', () => {});
        }, { name: 'UILayoutSystem' }));
        await app.tick(1 / 60);

        const scopes = app.getFrameCosts()!.scopes.filter((s) => s.name === 'ui.layout');
        expect(scopes).toHaveLength(1);
        expect(scopes[0].system).toBe('UILayoutSystem');
    });

    it('keeps getFrameScopes as the flat view of the same measurements', async () => {
        const app = App.new().enableStats();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            app.measureFrameScope('ui.layout', () => {});
        }, { name: 'UILayoutSystem' }));
        await app.tick(1 / 60);

        const flat = app.getFrameScopes()!;
        const costs = app.getFrameCosts()!;
        expect(flat.get('ui.layout')).toBe(costs.scopes.find((s) => s.name === 'ui.layout')!.ms);
    });
});
