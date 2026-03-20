import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { LinearLayout } from './layouts/LinearLayout';
import { PluginName } from '../systemLabels';

export class LinearLayoutPlugin implements Plugin {
    name = PluginName.LinearLayout;

    build(_app: App): void {
        registerComponent('LinearLayout', LinearLayout);
    }
}

export const linearLayoutPlugin = new LinearLayoutPlugin();
