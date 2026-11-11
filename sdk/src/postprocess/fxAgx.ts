// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The `esengine/fx-agx` subpath. Importing it INSTALLS the shader and the tables of the AgX view transform — see
 * effectSources.ts. A package that does not use AgX imports nothing and carries none of it.
 */
import { registerAgxEffectSources } from './sources/agx';

registerAgxEffectSources();

export {};
