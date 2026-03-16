import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { LayoutGroup } from './LayoutGroup';
import { PluginName } from '../systemLabels';

export class LayoutGroupPlugin implements Plugin {
    name = 'layoutGroup';
    dependencies = [PluginName.UILayout];

    build(_app: App): void {
        registerComponent('LayoutGroup', LayoutGroup);
    }
}

export const layoutGroupPlugin = new LayoutGroupPlugin();
