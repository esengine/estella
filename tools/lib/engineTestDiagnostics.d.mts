// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface MainProcessSample {
    at: string;
    freeMb: number;
    swapMb: number;
    rssMb: number;
    load: number;
}

export interface MainProcessReport {
    ticks: number;
    worstStallMs: number;
    totalMb: number;
    cpus: number;
    lowest: MainProcessSample;
    mostSwap: MainProcessSample;
    stalls: Array<MainProcessSample & { stallMs: number }>;
}

export function watchMainProcess(now?: () => number): () => MainProcessReport;
export function formatDiagnostics(report: MainProcessReport): string;
export default function setup(): () => void;
