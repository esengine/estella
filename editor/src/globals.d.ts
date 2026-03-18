interface Window {
    __ESENGINE_EDITOR__?: Record<string, unknown>;
    __esengine_componentSourceMap?: Map<string, string>;
    showSaveFilePicker?: (options?: {
        suggestedName?: string;
        types?: Array<{
            description?: string;
            accept: Record<string, string[]>;
        }>;
    }) => Promise<FileSystemFileHandle>;
}
