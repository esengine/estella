import { App } from 'esengine';
import { components } from './components';
import { systems } from './systems';

export async function main(Module: any): Promise<void> {
    const app = App.new();

    const cppRegistry = new Module.Registry();
    app.connectCpp(cppRegistry, Module.HEAPU8.buffer);

    for (const comp of Object.values(components)) {
        app.registerComponent(comp);
    }

    for (const sys of systems) {
        app.addSystem(sys);
    }

    const result = await app.loadSceneAsync('assets/scenes/main.esscene');
    if (result.success) {
        console.log(`Loaded scene: ${result.sceneName} (${result.entityCount} entities)`);
    } else {
        console.error(`Failed to load scene: ${result.error}`);
    }

    app.run();
}
