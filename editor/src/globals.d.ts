interface Window {
    __ESENGINE_EDITOR__?: Record<string, unknown>;
    __esengine_registerComponent?: (name: string, defaults: Record<string, unknown>, isTag: boolean) => void;
    __esengine_componentSourceMap?: Map<string, string>;
    showSaveFilePicker?: (options?: {
        suggestedName?: string;
        types?: Array<{
            description?: string;
            accept: Record<string, string[]>;
        }>;
    }) => Promise<FileSystemFileHandle>;
}
