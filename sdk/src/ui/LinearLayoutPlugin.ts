import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { LinearLayout } from './layouts/LinearLayout';

export class LinearLayoutPlugin implements Plugin {
    name = 'linearLayout';

    build(_app: App): void {
        registerComponent('LinearLayout', LinearLayout);
    }
}

export const linearLayoutPlugin = new LinearLayoutPlugin();
