import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { UIMask } from './UIMask';

export class UIMaskPlugin implements Plugin {
    name = 'uiMask';

    build(app: App): void {
        registerComponent('UIMask', UIMask);
    }
}

export const uiMaskPlugin = new UIMaskPlugin();
