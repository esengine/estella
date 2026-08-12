// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  profileReport.ts — the profile as an agent reads it: ranked, and honest
 *        about what it left out.
 */

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
  realm: 'edit' | 'play';
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
  /** Per frame over the window. `totalMs = cpuMs + waitMs + idleMs`; gpu is parallel. */
  frame: { totalMs: number; cpuMs: number; waitMs: number; idleMs: number; gpuMs: number };
  domains: Array<{ domain: string; ms: number }>;
  /** Domains that cost nothing this window — installed and idle. */
  freeDomains: number;
  /** Costliest systems over the window, per frame. */
  systems: ProfileReportSystem[];
  /** Systems ranked below the cut. Zero means the list above is all of them. */
  omittedSystems: number;
}
