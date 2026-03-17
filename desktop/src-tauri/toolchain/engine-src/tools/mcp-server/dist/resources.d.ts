import type { BridgeClient } from './bridge.js';
export declare function registerResources(server: {
    resource: Function;
    prompt: Function;
}, bridge: BridgeClient): void;
