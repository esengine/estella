// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { addEntryPlugin } from '../runtime/entryPlugins';
import { ImportedScenePlugin } from './importedScenePlugin';

export function registerImportedSceneSupport(): void {
    addEntryPlugin('importedScene', () => new ImportedScenePlugin());
}
