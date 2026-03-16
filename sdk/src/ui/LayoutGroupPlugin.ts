import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { LayoutGroup } from './LayoutGroup';

export class LayoutGroupPlugin implements Plugin {
    build(_app: App): void {
        registerComponent('LayoutGroup', LayoutGroup);
    }
}

export const layoutGroupPlugin = new LayoutGroupPlugin();
