export { PlayModeService, getPlayModeService } from './PlayModeService';
export { RuntimeStoreProxy } from './RuntimeStoreProxy';
export { ScriptInjector } from './ScriptInjector';
export { OutputService } from './OutputService';
export { ClipboardService } from './ClipboardService';
export { ShellService } from './ShellService';
export { ProfilerService } from './ProfilerService';
export { FrameDebuggerService } from './FrameDebuggerService';
export { NavigationService } from './NavigationService';
export { SpineService } from './SpineService';
export { RuntimeService } from './RuntimeService';
export { ScriptService } from './ScriptService';
export { ExtensionService } from './ExtensionService';
export { PreviewService } from './PreviewService';
export { SceneService } from './SceneService';
export { ProjectService } from './ProjectService';
export { MultiWindowService } from './MultiWindowService';
export { PluginManager } from './PluginManager';

import type { OutputService } from './OutputService';
import type { ClipboardService } from './ClipboardService';
import type { ShellService } from './ShellService';
import type { ProfilerService } from './ProfilerService';
import type { FrameDebuggerService } from './FrameDebuggerService';
import type { NavigationService } from './NavigationService';
import type { SpineService } from './SpineService';
import type { RuntimeService } from './RuntimeService';
import type { ScriptService } from './ScriptService';
import type { ExtensionService } from './ExtensionService';
import type { PreviewService } from './PreviewService';
import type { SceneService } from './SceneService';
import type { ProjectService } from './ProjectService';
import type { MultiWindowService } from './MultiWindowService';
import { getEditorContainer } from '../container/EditorContainer';
import {
    SCENE_SERVICE,
    CLIPBOARD_SERVICE,
    PREVIEW_SERVICE,
    SCRIPT_SERVICE,
    EXTENSION_SERVICE,
    SHELL_SERVICE,
    PROFILER_SERVICE,
    FRAME_DEBUGGER_SERVICE,
    LAYOUT_SERVICE,
    NAVIGATION_SERVICE,
    OUTPUT_SERVICE,
    SPINE_SERVICE,
    RUNTIME_SERVICE,
    MULTI_WINDOW_SERVICE,
    PROJECT_SERVICE,
    PLUGIN_MANAGER,
} from '../container/tokens';

const SERVICE_KEY = 'default';

export function getSceneService(): SceneService {
    return getEditorContainer().get(SCENE_SERVICE, SERVICE_KEY)!;
}

export function getClipboardService(): ClipboardService {
    return getEditorContainer().get(CLIPBOARD_SERVICE, SERVICE_KEY)!;
}

export function getPreviewService(): PreviewService {
    return getEditorContainer().get(PREVIEW_SERVICE, SERVICE_KEY)!;
}

export function getScriptService(): ScriptService {
    return getEditorContainer().get(SCRIPT_SERVICE, SERVICE_KEY)!;
}

export function getExtensionService(): ExtensionService {
    return getEditorContainer().get(EXTENSION_SERVICE, SERVICE_KEY)!;
}

export function getShellService(): ShellService {
    return getEditorContainer().get(SHELL_SERVICE, SERVICE_KEY)!;
}

export function getProfilerService(): ProfilerService | undefined {
    return getEditorContainer().get(PROFILER_SERVICE, SERVICE_KEY);
}

export function getFrameDebuggerService(): FrameDebuggerService | undefined {
    return getEditorContainer().get(FRAME_DEBUGGER_SERVICE, SERVICE_KEY);
}

export function getLayoutService() {
    return getEditorContainer().get(LAYOUT_SERVICE, SERVICE_KEY)!;
}

export function getNavigationService(): NavigationService {
    return getEditorContainer().get(NAVIGATION_SERVICE, SERVICE_KEY)!;
}

export function getOutputService(): OutputService {
    return getEditorContainer().get(OUTPUT_SERVICE, SERVICE_KEY)!;
}

export function getSpineService(): SpineService {
    return getEditorContainer().get(SPINE_SERVICE, SERVICE_KEY)!;
}

export function getRuntimeService(): RuntimeService {
    return getEditorContainer().get(RUNTIME_SERVICE, SERVICE_KEY)!;
}

export function getMultiWindowService(): MultiWindowService {
    return getEditorContainer().get(MULTI_WINDOW_SERVICE, SERVICE_KEY)!;
}

export function getProjectService(): ProjectService {
    return getEditorContainer().get(PROJECT_SERVICE, SERVICE_KEY)!;
}

export function getPluginManager() {
    return getEditorContainer().get(PLUGIN_MANAGER, SERVICE_KEY)!;
}
