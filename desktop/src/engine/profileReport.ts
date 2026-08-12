// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  profileReport.ts — the profile as an agent reads it: ranked, and honest
 *        about what it left out.
 */
import type { CaptureSummary, FrameProfile, ProfileNode } from 'esengine';

const r2 = (n: number): number => Math.round(n * 100) / 100;

const BREAK_PREFIX = 'batch.break.';

export interface ProfileReportQuery {
  calls: number;
  scanned: number;
  filtered: number;
}

export interface ProfileReportSystem {
  name: string;
  domain: string;
  ms: number;
  /** Absent when the system runs no query. */
  query?: ProfileReportQuery;
  scopes: Array<{ name: string; ms: number; kind: string }>;
}

export interface ProfileReport {
  /** Where the numbers came from: a live realm, or a capture's own source. */
  origin: string;
  windowMs: number;
  frames: number;
  /** No frame ran: nothing is animating, or the editor window is in the background. */
  stalled: boolean;
  budgetMs: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  longFrames: number;
  worstFrameMs: number;
  /**
   * The worst frame's own breakdown, which is what a stutter actually is — the
   * averages above describe the frames that were fine.
   */
  worstFrame: { ms: number; domains: Array<{ domain: string; ms: number }> } | null;
  /** Per frame. `totalMs = cpuMs + waitMs + idleMs`; gpu is a parallel track. */
  frame: { totalMs: number; cpuMs: number; waitMs: number; idleMs: number; gpuMs: number };
  domains: Array<{ domain: string; ms: number }>;
  /** Domains that cost nothing this window — installed and idle. */
  freeDomains: number;
  /**
   * Per frame. `breaks` is reason → draw calls that reason started, so `drawCalls`
   * reads as what it is made of; `mergedAway` is what the batcher did fold in.
   * Reasons are the merge predicate's own: shader, blend, layout, material,
   * depth, cull, state, scissor, stencil, indexGap, textureSlots, instanced.
   */
  render: {
    drawCalls: number;
    mergedAway: number;
    triangles: number;
    entities: number;
    breaks: Record<string, number>;
  };
  /** Averaged per frame. -1 where the source did not record that heap. */
  memory: { wasmMB: number; jsHeapMB: number; vramMB: number };
  /** Costliest systems over the window, per frame. */
  systems: ProfileReportSystem[];
  /** Systems ranked below the cut. Zero means the list above is all of them. */
  omittedSystems: number;
}

/** The `batch.break.*` counters as reason → draws, by their bare reason name. */
function batchBreaks(counters: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key in counters) {
    if (key.startsWith(BREAK_PREFIX)) out[key.slice(BREAK_PREFIX.length)] = r2(counters[key]);
  }
  return out;
}

function domainRows(profile: FrameProfile): Array<{ domain: string; ms: number }> {
  return profile.domains.filter((d) => r2(d.ms) > 0).map((d) => ({ domain: d.id, ms: r2(d.ms) }));
}

function systemRows(profile: FrameProfile): Array<{ domain: string; node: ProfileNode }> {
  return profile.domains
    .flatMap((d) => d.children.map((node) => ({ domain: d.id, node })))
    .sort((a, b) => b.node.ms - a.node.ms);
}

const MB = 1 / (1024 * 1024);
const mb = (bytes: number | undefined): number => (bytes && bytes > 0 ? r2(bytes * MB) : -1);

export interface ProfileReportContext {
  origin: string;
  windowMs: number;
  stalled: boolean;
  worst: FrameProfile | null;
  /** Averaged bytes per frame, where the source recorded them. */
  memory?: { wasmBytes?: number; jsHeapBytes?: number; vramBytes?: number };
  topSystems?: number;
}

/**
 * Project a summary into the reply an agent gets. Pure, and shared by the live
 * window and an imported capture, so "where did the time go" reads the same
 * whether it was asked of this editor or of a file recorded on a phone.
 */
export function profileReportOf(summary: CaptureSummary, ctx: ProfileReportContext): ProfileReport {
  const systems = systemRows(summary.mean);
  const shown = systems.slice(0, ctx.topSystems ?? 12);
  return {
    origin: ctx.origin,
    windowMs: ctx.windowMs,
    frames: summary.frames,
    stalled: ctx.stalled,
    budgetMs: r2(summary.budgetMs),
    fps: summary.fps,
    p50: r2(summary.p50),
    p95: r2(summary.p95),
    p99: r2(summary.p99),
    longFrames: summary.longFrames,
    worstFrameMs: r2(summary.worstFrameMs),
    worstFrame: ctx.worst ? { ms: r2(ctx.worst.frameMs), domains: domainRows(ctx.worst) } : null,
    frame: {
      totalMs: r2(summary.mean.frameMs),
      cpuMs: r2(summary.mean.cpuMs),
      waitMs: r2(summary.mean.waitMs),
      idleMs: r2(summary.mean.idleMs),
      gpuMs: summary.mean.gpuMs >= 0 ? r2(summary.mean.gpuMs) : -1,
    },
    // A plugin that is installed and costs nothing is not an answer to "where
    // did the time go", and there are two dozen of them. Counted, not hidden.
    domains: domainRows(summary.mean),
    freeDomains: summary.mean.domains.filter((d) => r2(d.ms) === 0).length,
    render: {
      drawCalls: r2(summary.drawCalls),
      mergedAway: r2(summary.counters['batch.merged'] ?? 0),
      triangles: Math.round(summary.triangles),
      entities: Math.round(summary.entities),
      breaks: batchBreaks(summary.counters),
    },
    memory: {
      wasmMB: mb(ctx.memory?.wasmBytes),
      jsHeapMB: mb(ctx.memory?.jsHeapBytes),
      vramMB: mb(ctx.memory?.vramBytes),
    },
    systems: shown.map(({ domain, node }) => ({
      name: node.label,
      domain,
      ms: r2(node.ms),
      ...(node.query
        ? {
            query: {
              calls: r2(node.query.calls),
              scanned: Math.round(node.query.scanned),
              filtered: Math.round(node.query.filtered),
            },
          }
        : {}),
      scopes: node.children
        .filter((c) => c.ms >= 0.05)
        .map((c) => ({ name: c.label, ms: r2(c.ms), kind: c.kind })),
    })),
    omittedSystems: systems.length - shown.length,
  };
}
