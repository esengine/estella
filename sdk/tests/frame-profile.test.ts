// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    buildFrameProfile,
    scopeDomain,
    DOMAIN_SCRIPTS,
    type FrameProfileInput,
    type ProfileNode,
} from '../src/app/frameProfile';

function findNode(nodes: readonly ProfileNode[], id: string): ProfileNode | null {
    for (const n of nodes) {
        if (n.id === id) return n;
        const hit = findNode(n.children, id);
        if (hit) return hit;
    }
    return null;
}

function assertChildrenSum(node: ProfileNode): void {
    if (node.children.length === 0) return;
    const sum = node.children.reduce((acc, c) => acc + c.ms, 0);
    expect(sum).toBeCloseTo(node.ms, 4);
    for (const c of node.children) assertChildrenSum(c);
}

describe('scopeDomain', () => {
    it('takes the segment before the first dot', () => {
        expect(scopeDomain('render.submit')).toBe('render');
        expect(scopeDomain('render.gl.upload')).toBe('render');
    });

    it('treats an undotted name as its own domain', () => {
        expect(scopeDomain('layout')).toBe('layout');
    });
});

describe('buildFrameProfile', () => {
    it('groups systems under their domain and sums the domain from them', () => {
        const profile = buildFrameProfile({
            frameMs: 16.7,
            systems: [
                { name: 'EnemyAI', ms: 1.8, domain: DOMAIN_SCRIPTS },
                { name: 'ProjectileSystem', ms: 0.9, domain: DOMAIN_SCRIPTS },
                { name: 'PhysicsStep', ms: 3.2, domain: 'physics' },
            ],
            scopes: [],
        });

        const scripts = findNode(profile.domains, DOMAIN_SCRIPTS);
        expect(scripts?.ms).toBeCloseTo(2.7, 4);
        expect(scripts?.children.map((c) => c.label)).toEqual(['EnemyAI', 'ProjectileSystem']);
        expect(findNode(profile.domains, 'physics')?.ms).toBeCloseTo(3.2, 4);
    });

    it('ranks domains and their systems by cost', () => {
        const profile = buildFrameProfile({
            frameMs: 16.7,
            systems: [
                { name: 'Cheap', ms: 0.2, domain: DOMAIN_SCRIPTS },
                { name: 'Dear', ms: 4.0, domain: DOMAIN_SCRIPTS },
                { name: 'PhysicsStep', ms: 3.2, domain: 'physics' },
            ],
            scopes: [],
        });

        expect(profile.domains.map((d) => d.id)).toEqual([DOMAIN_SCRIPTS, 'physics']);
        expect(profile.domains[0].children.map((c) => c.label)).toEqual(['Dear', 'Cheap']);
    });

    it('keeps frameMs = cpu + wait + idle', () => {
        const profile = buildFrameProfile({
            frameMs: 16.7,
            systems: [{ name: 'PhysicsStep', ms: 3.2, domain: 'physics' }],
            scopes: [],
        });

        expect(profile.cpuMs + profile.waitMs + profile.idleMs).toBeCloseTo(profile.frameMs, 4);
        expect(profile.idleMs).toBeCloseTo(13.5, 4);
    });

    it('never reports negative idle when the frame is shorter than its measurements', () => {
        const profile = buildFrameProfile({
            frameMs: 1,
            systems: [{ name: 'PhysicsStep', ms: 9, domain: 'physics' }],
            scopes: [],
        });

        expect(profile.idleMs).toBe(0);
        expect(profile.frameMs).toBeCloseTo(9, 4);
    });

    it('nests a scope under the system it ran inside, with the rest accounted for', () => {
        const profile = buildFrameProfile({
            frameMs: 16.7,
            systems: [{ name: 'RenderSystem', ms: 4, domain: 'render' }],
            scopes: [
                { name: 'render.resolveCameras', ms: 1, system: 'RenderSystem', remainder: 'work' },
            ],
        });

        const sys = findNode(profile.domains, 'RenderSystem');
        expect(sys?.ms).toBeCloseTo(4, 4);
        expect(sys?.children.map((c) => c.label)).toEqual(['rest', 'render.resolveCameras']);
        assertChildrenSum(profile.domains[0]);
    });

    it('reads an empty frame as all idle', () => {
        const profile = buildFrameProfile({ frameMs: 16.7, systems: [], scopes: [] });

        expect(profile.domains).toEqual([]);
        expect(profile.cpuMs).toBe(0);
        expect(profile.idleMs).toBeCloseTo(16.7, 4);
    });

    it('carries gpu as a parallel track outside the cpu sums', () => {
        const profile = buildFrameProfile({
            frameMs: 16.7,
            systems: [{ name: 'RenderSystem', ms: 2, domain: 'render' }],
            scopes: [],
            gpuMs: 5.6,
        });

        expect(profile.gpuMs).toBeCloseTo(5.6, 4);
        expect(profile.cpuMs).toBeCloseTo(2, 4);
        expect(profile.cpuMs + profile.waitMs + profile.idleMs).toBeCloseTo(profile.frameMs, 4);
    });

    it('reports gpu as unavailable rather than zero when no timer answered', () => {
        const profile = buildFrameProfile({ frameMs: 16.7, systems: [], scopes: [] });
        expect(profile.gpuMs).toBe(-1);
    });

    // The empty-scene reading this model has to reproduce: a 2.1ms RenderSystem
    // that is 0.03ms of work and the rest blocked on the swapchain.
    describe('a scope whose remainder is a wait', () => {
        const emptyScene: FrameProfileInput = {
            frameMs: 16.7,
            systems: [{ name: 'RenderSystem', ms: 2.1, domain: 'render' }],
            scopes: [{ name: 'render.submit', ms: 2.1, system: 'RenderSystem', remainder: 'wait' }],
            nativeScopes: [
                { name: 'render.collect', ms: 0.02, system: '', remainder: 'work' },
                { name: 'render.finalize', ms: 0.01, system: '', remainder: 'work' },
            ],
        };

        it('keeps the wait out of the system, the domain and the cpu total', () => {
            const profile = buildFrameProfile(emptyScene);

            expect(findNode(profile.domains, 'RenderSystem')?.ms).toBeCloseTo(0.03, 4);
            expect(findNode(profile.domains, 'render')?.ms).toBeCloseTo(0.03, 4);
            expect(profile.cpuMs).toBeCloseTo(0.03, 4);
            expect(profile.waitMs).toBeCloseTo(2.07, 4);
        });

        it('still adds up to the frame', () => {
            const profile = buildFrameProfile(emptyScene);
            expect(profile.cpuMs + profile.waitMs + profile.idleMs).toBeCloseTo(16.7, 4);
        });

        it('shows the native work under the scope that blocked on it', () => {
            const profile = buildFrameProfile(emptyScene);
            const scope = findNode(profile.domains, 'RenderSystem/render.submit');

            expect(scope?.children.map((c) => c.label)).toEqual(['wait', 'render.collect', 'render.finalize']);
            assertChildrenSum(scope!);
        });

        it('does not hand the same native scope to a work scope', () => {
            const profile = buildFrameProfile({
                ...emptyScene,
                scopes: [{ name: 'render.submit', ms: 2.1, system: 'RenderSystem', remainder: 'work' }],
            });

            expect(profile.waitMs).toBe(0);
            expect(findNode(profile.domains, 'RenderSystem/render.submit')?.children.map((c) => c.label))
                .toEqual(['rest']);
        });
    });
});
