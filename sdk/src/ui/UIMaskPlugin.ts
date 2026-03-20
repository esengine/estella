import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { UIMask } from './UIMask';
import { PluginName } from '../systemLabels';

export class UIMaskPlugin implements Plugin {
    name = PluginName.UIMask;

    build(app: App): void {
        registerComponent('UIMask', UIMask);
    }
}

export const uiMaskPlugin = new UIMaskPlugin();
