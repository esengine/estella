// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    install.ts
 * @brief   Installs the WGSL transpiler on shader compilation.
 */
import { installWgslTwinSource } from '../../render/material';
import { withWgslTwin } from './twin';

/**
 * From now on a shader written only in GLSL is given its WGSL as it compiles. An entry that draws through WebGPU calls this: an
 * entry's prologue is a call it makes (see rolldown.config.js), so a module imported for its side effect would be dropped.
 */
export function installWgslTranspiler(): void {
    installWgslTwinSource(withWgslTwin);
}
