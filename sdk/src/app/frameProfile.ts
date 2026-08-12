// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frameProfile.ts — the per-frame cost model every profiler view reads.
 */
import type { QueryCost } from '../ecs/query';

export type { QueryCost };

/** Systems a project registered, as opposed to any engine plugin's. */
export const DOMAIN_SCRIPTS = 'scripts';

/** Systems registered outside both a plugin build and the project bundle. */
export const DOMAIN_UNATTRIBUTED = 'unattributed';

/** Time under a scope that none of its children claimed. */
export type ScopeRemainder = 'work' | 'wait';

export interface SystemCost {
    readonly name: string;
    readonly ms: number;
    readonly domain: string;
    /** Absent when the system ran no query, or when accounting was off. */
    readonly query?: QueryCost;
}

export interface ScopeCost {
    readonly name: string;
    readonly ms: number;
    /** The system this ran inside; '' when it ran outside every system. */
    readonly system: string;
    readonly remainder: ScopeRemainder;
}

export interface FrameProfileInput {
    readonly frameMs: number;
    readonly systems: readonly SystemCost[];
    readonly scopes: readonly ScopeCost[];
    /** Scopes measured inside wasm. Adopted by the wait scope of their domain. */
    readonly nativeScopes?: readonly ScopeCost[];
    readonly gpuMs?: number;
}

export type ProfileNodeKind = 'domain' | 'system' | 'scope' | 'rest';

export interface ProfileNode {
    readonly id: string;
    readonly label: string;
    readonly ms: number;
    readonly kind: ProfileNodeKind;
    readonly children: readonly ProfileNode[];
    /** On a system node that ran a query — why its time is what it is. */
    readonly query?: QueryCost;
}

/**
 * `frameMs === cpuMs + waitMs + idleMs`, and every node's ms equals the sum of
 * its children. `gpuMs` is a parallel track and is in none of those sums.
 */
export interface FrameProfile {
    readonly frameMs: number;
    readonly cpuMs: number;
    readonly waitMs: number;
    readonly idleMs: number;
    readonly gpuMs: number;
    readonly domains: readonly ProfileNode[];
}

/** Below this a row is noise, and a `rest` row for it would be rounding dust. */
const EPS_MS = 0.05;

/**
 * Average a window of frames into one profile, per frame. A node is divided by
 * the whole window, not by the frames it appeared in: dividing by its own
 * appearances would report an every-fourth-frame system four times too dear.
 * Obeys the same sums a single frame does.
 */
export function meanFrameProfile(profiles: readonly FrameProfile[]): FrameProfile {
    if (profiles.length === 0) {
        return { frameMs: 0, cpuMs: 0, waitMs: 0, idleMs: 0, gpuMs: -1, domains: [] };
    }
    const n = profiles.length;
    const withGpu = profiles.filter((p) => p.gpuMs >= 0);
    return {
        frameMs: profiles.reduce((a, p) => a + p.frameMs, 0) / n,
        cpuMs: profiles.reduce((a, p) => a + p.cpuMs, 0) / n,
        waitMs: profiles.reduce((a, p) => a + p.waitMs, 0) / n,
        idleMs: profiles.reduce((a, p) => a + p.idleMs, 0) / n,
        gpuMs: withGpu.length > 0 ? withGpu.reduce((a, p) => a + p.gpuMs, 0) / withGpu.length : -1,
        domains: meanNodes(profiles.map((p) => p.domains), n),
    };
}

function meanNodes(perFrame: ReadonlyArray<readonly ProfileNode[]>, frames: number): ProfileNode[] {
    const acc = new Map<string, { node: ProfileNode; ms: number; kids: ProfileNode[][]; query: QueryCost | null }>();
    for (const nodes of perFrame) {
        for (const node of nodes) {
            const prev = acc.get(node.id);
            if (prev) {
                prev.ms += node.ms;
                prev.kids.push([...node.children]);
                if (node.query) {
                    prev.query = prev.query
                        ? {
                            calls: prev.query.calls + node.query.calls,
                            scanned: prev.query.scanned + node.query.scanned,
                            filtered: prev.query.filtered + node.query.filtered,
                        }
                        : { ...node.query };
                }
            } else {
                acc.set(node.id, {
                    node,
                    ms: node.ms,
                    kids: [[...node.children]],
                    query: node.query ? { ...node.query } : null,
                });
            }
        }
    }
    const out: ProfileNode[] = [];
    for (const e of acc.values()) {
        out.push({
            id: e.node.id,
            label: e.node.label,
            ms: e.ms / frames,
            kind: e.node.kind,
            children: meanNodes(e.kids, frames),
            ...(e.query
                ? {
                    query: {
                        calls: e.query.calls / frames,
                        scanned: e.query.scanned / frames,
                        filtered: e.query.filtered / frames,
                    },
                }
                : {}),
        });
    }
    out.sort(byMsDesc);
    return out;
}

/** The part of a dotted scope name that names its domain. */
export function scopeDomain(name: string): string {
    const dot = name.indexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

function sumMs(nodes: readonly ProfileNode[]): number {
    let total = 0;
    for (const n of nodes) total += n.ms;
    return total;
}

function byMsDesc(a: ProfileNode, b: ProfileNode): number {
    return b.ms - a.ms;
}

/**
 * Fold one frame's flat measurements into the tree the profiler renders.
 *
 * Pure, so the live editor view, an imported capture and the agent all derive
 * the same numbers from the same rule rather than each rounding their own way.
 */
export function buildFrameProfile(input: FrameProfileInput): FrameProfile {
    const nativeByDomain = new Map<string, ScopeCost[]>();
    for (const n of input.nativeScopes ?? []) {
        const d = scopeDomain(n.name);
        const list = nativeByDomain.get(d);
        if (list) list.push(n); else nativeByDomain.set(d, [n]);
    }

    const scopesBySystem = new Map<string, ScopeCost[]>();
    for (const s of input.scopes) {
        const list = scopesBySystem.get(s.system);
        if (list) list.push(s); else scopesBySystem.set(s.system, [s]);
    }

    let waitTotal = 0;
    const domains = new Map<string, ProfileNode[]>();

    for (const sys of input.systems) {
        const children: ProfileNode[] = [];
        let systemWait = 0;

        for (const scope of scopesBySystem.get(sys.name) ?? []) {
            const adopted = scope.remainder === 'wait'
                ? (nativeByDomain.get(scopeDomain(scope.name)) ?? [])
                : [];
            const grandChildren = adopted.map((n): ProfileNode => ({
                id: `${sys.name}/${scope.name}/${n.name}`,
                label: n.name,
                ms: n.ms,
                kind: 'scope',
                children: [],
            }));
            const unclaimed = Math.max(0, scope.ms - sumMs(grandChildren));
            // A wait leaves the tree entirely rather than becoming a row in it:
            // the tree is work, and time blocked on a swapchain is not work. It
            // survives as the profile's waitMs, which the frame identity carries.
            if (scope.remainder === 'wait') {
                systemWait += unclaimed;
            } else if (unclaimed >= EPS_MS && grandChildren.length > 0) {
                grandChildren.push({
                    id: `${sys.name}/${scope.name}/~`,
                    label: 'rest',
                    ms: unclaimed,
                    kind: 'rest',
                    children: [],
                });
            }
            grandChildren.sort(byMsDesc);
            const scopeWork = scope.remainder === 'wait' ? scope.ms - unclaimed : scope.ms;
            children.push({
                id: `${sys.name}/${scope.name}`,
                label: scope.name,
                ms: scopeWork,
                kind: 'scope',
                children: grandChildren,
            });
        }

        const work = Math.max(0, sys.ms - systemWait);
        const rest = Math.max(0, work - sumMs(children));
        if (children.length > 0 && rest >= EPS_MS) {
            children.push({ id: `${sys.name}/~`, label: 'rest', ms: rest, kind: 'rest', children: [] });
        }
        children.sort(byMsDesc);

        waitTotal += systemWait;
        const node: ProfileNode = {
            id: sys.name,
            label: sys.name,
            ms: work,
            kind: 'system',
            children,
            ...(sys.query ? { query: sys.query } : {}),
        };
        const list = domains.get(sys.domain);
        if (list) list.push(node); else domains.set(sys.domain, [node]);
    }

    const domainNodes: ProfileNode[] = [];
    for (const [domain, systems] of domains) {
        systems.sort(byMsDesc);
        domainNodes.push({
            id: domain,
            label: domain,
            ms: sumMs(systems),
            kind: 'domain',
            children: systems,
        });
    }
    domainNodes.sort(byMsDesc);

    const cpuMs = sumMs(domainNodes);
    const frameMs = Math.max(input.frameMs, cpuMs + waitTotal);
    return {
        frameMs,
        cpuMs,
        waitMs: waitTotal,
        idleMs: Math.max(0, frameMs - cpuMs - waitTotal),
        gpuMs: input.gpuMs ?? -1,
        domains: domainNodes,
    };
}
