// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Types for bindingDispositions.mjs, which the SDK's binding handshake reads. */

export declare const PROBE_GUARD: string;
export declare const PROBE_HEADER: string;

export interface BindingDisposition {
    inProductionSurface: boolean;
    means: string;
}

export declare const DISPOSITIONS: Record<string, BindingDisposition>;

export interface TestProbeBinding {
    id: string;
    why: string;
}

export declare const TEST_PROBE_BINDINGS: TestProbeBinding[];
