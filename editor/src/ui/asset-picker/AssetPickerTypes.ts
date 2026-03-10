export interface AssetPickerOptions {
    title?: string;
    allowedTypes?: string[];
    extensions?: string[];
    multiSelect?: boolean;
    initialPath?: string;
}

export interface AssetPickerResult {
    relativePath: string;
    uuid: string | null;
    name: string;
}
