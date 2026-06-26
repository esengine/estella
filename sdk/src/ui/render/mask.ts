// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app';
import { registerComponent } from '../../component';
import { UIMask } from '../core/ui-mask';
import { PluginName } from '../../systemLabels';

export class UIMaskPlugin implements Plugin {
    name = PluginName.UIMask;

    build(app: App): void {
        registerComponent('UIMask', UIMask);
    }
}

export const uiMaskPlugin = new UIMaskPlugin();
