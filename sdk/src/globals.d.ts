interface Window {
    __esengine_registerComponent?: (name: string, defaults: Record<string, unknown>, isTag: boolean) => void;
    __esengine_componentRegistry?: Map<string, unknown>;
    __esengine_spineEvent?: (entity: number, eventData: unknown) => void;
    __esengine_pendingSystems?: Array<{ schedule: number; system: unknown }>;
    __esengine_componentSourceMap?: Map<string, string>;
}
