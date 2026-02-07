interface Window {
    __esengine_registerComponent?: (name: string, defaults: Record<string, unknown>, isTag: boolean) => void;
    __esengine_spineEvent?: (entity: number, eventData: unknown) => void;
}
