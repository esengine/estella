// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export type NativeScriptDisposition =
    'core-global' | 'native-subpath' | 'forbidden-native-script';

export interface NativeScriptDispositionClass {
    readonly means: string;
    readonly resolvesTo: string | null;
    readonly needsNamespace: boolean;
}

export interface NativeScriptModule {
    readonly disposition: NativeScriptDisposition;
    /** Owed by `forbidden-native-script`: what to reach for instead, and why. */
    readonly why?: string;
}

export const NATIVE_MODULE_REGISTRY: string;
export const DISPOSITIONS: Readonly<Record<NativeScriptDisposition, NativeScriptDispositionClass>>;
export const MODULES: Readonly<Record<string, NativeScriptModule>>;
export function subpathOf(specifier: string): string;
export function specifierOf(subpath: string): string;
export function nativeSubpaths(): string[];
