import type { ESEngineModule } from 'esengine';

declare global {
    interface Window {
        __ESEngineModule?: (config?: unknown) => Promise<ESEngineModule>;
    }
}
