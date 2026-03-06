import { saveSceneToFile, saveSceneToPath, loadSceneFromFile, loadSceneFromPath, hasFileHandle, clearFileHandle } from '../io/SceneSerializer';
import { isAbsolutePath, joinPath, getProjectDir } from '../utils/path';
import { getAssetLibrary } from '../asset/AssetLibrary';
import { getSettingsValue } from '../settings';
import { showDialog } from '../ui/dialog';
import { loadEditorLocalSettings, saveEditorLocalSetting } from '../launcher/ProjectService';
import type { EditorStore } from '../store/EditorStore';
import type { PreviewService } from './PreviewService';

export type DirtyPanelChecker = () => { isDirty: boolean; save: () => Promise<boolean> };

export class SceneService {
    private store_: EditorStore;
    private projectPath_: string | null;
    private previewService_!: PreviewService;
    private assetLibraryReady_: Promise<void> = Promise.resolve();
    private scriptsReady_: Promise<void> = Promise.resolve();
    private dirtyCheckers_: DirtyPanelChecker[] = [];

    constructor(store: EditorStore, projectPath: string | null) {
        this.store_ = store;
        this.projectPath_ = projectPath;
    }

    registerDirtyChecker(checker: DirtyPanelChecker): () => void {
        this.dirtyCheckers_.push(checker);
        return () => {
            const idx = this.dirtyCheckers_.indexOf(checker);
            if (idx >= 0) this.dirtyCheckers_.splice(idx, 1);
        };
    }

    private async saveDirtyPanels_(): Promise<void> {
        const promises: Promise<boolean>[] = [];
        for (const checker of this.dirtyCheckers_) {
            const { isDirty, save } = checker();
            if (isDirty) promises.push(save());
        }
        await Promise.all(promises);
    }

    setPreviewService(previewService: PreviewService): void {
        this.previewService_ = previewService;
    }

    setAssetLibraryReady(promise: Promise<void>): void {
        this.assetLibraryReady_ = promise;
    }

    setScriptsReady(promise: Promise<void>): void {
        this.scriptsReady_ = promise;
    }

    async newScene(): Promise<void> {
        if (this.store_.isDirty) {
            const result = await this.showUnsavedChangesPrompt_();
            if (result === 'cancel') return;
            if (result === 'save') await this.saveScene();
        }
        const w = getSettingsValue<number>('project.designWidth');
        const h = getSettingsValue<number>('project.designHeight');
        this.store_.newScene('Untitled', { width: w, height: h });
        clearFileHandle();
    }

    async saveScene(): Promise<void> {
        if (this.store_.isEditingPrefab) {
            await this.store_.savePrefabEditing();
            return;
        }

        await this.saveDirtyPanels_();

        const filePath = this.store_.filePath;

        if (filePath && hasFileHandle()) {
            const success = await saveSceneToPath(this.store_.scene, filePath);
            if (success) {
                this.store_.markSaved();
                this.previewService_.refreshFiles();
                return;
            }
        }

        const savedPath = await saveSceneToFile(this.store_.scene);
        if (savedPath) {
            this.store_.markSaved(savedPath);
            this.previewService_.refreshFiles();
        }
    }

    async saveSceneAs(): Promise<void> {
        clearFileHandle();
        const savedPath = await saveSceneToFile(this.store_.scene);
        if (savedPath) {
            this.store_.markSaved(savedPath);
        }
    }

    async loadScene(): Promise<void> {
        if (this.store_.isDirty) {
            const result = await this.showUnsavedChangesPrompt_();
            if (result === 'cancel') return;
            if (result === 'save') await this.saveScene();
        }
        await this.assetLibraryReady_;
        const scene = await loadSceneFromFile();
        if (scene) {
            await getAssetLibrary().migrateScene(scene);
            this.store_.loadScene(scene);
        }
    }

    async openSceneFromPath(scenePath: string): Promise<void> {
        if (this.store_.isEditingPrefab) {
            await this.store_.exitPrefabEditMode();
        }

        let resolvedPath = scenePath;
        if (!isAbsolutePath(scenePath) && this.projectPath_) {
            const projectDir = getProjectDir(this.projectPath_);
            resolvedPath = joinPath(projectDir, scenePath);
        }

        await this.assetLibraryReady_;
        const scene = await loadSceneFromPath(resolvedPath);
        if (scene) {
            const migrated = await getAssetLibrary().migrateScene(scene);
            if (migrated) {
                await saveSceneToPath(scene, resolvedPath);
            }
            this.store_.loadScene(scene, resolvedPath);
            this.saveLastOpenedScene_(scenePath);
            console.log('Scene loaded:', resolvedPath);
        }
    }

    async restoreLastScene(): Promise<void> {
        if (!this.projectPath_) return;
        await this.scriptsReady_;
        const settings = await loadEditorLocalSettings(this.projectPath_);
        const lastScene = settings?.lastOpenedScene as string | undefined;
        if (lastScene) {
            await this.openSceneFromPath(lastScene);
        }
    }

    async showUnsavedChangesPrompt_(): Promise<'save' | 'discard' | 'cancel'> {
        return new Promise((resolve) => {
            let resolved = false;
            showDialog({
                title: 'Unsaved Changes',
                content: 'You have unsaved changes. Save before continuing?',
                buttons: [
                    { label: 'Cancel', role: 'cancel' },
                    {
                        label: "Don't Save", role: 'custom',
                        onClick: () => { resolved = true; resolve('discard'); },
                    },
                    {
                        label: 'Save', role: 'confirm', primary: true,
                        onClick: () => { resolved = true; resolve('save'); },
                    },
                ],
                closeOnEscape: true,
            }).then((result) => {
                if (!resolved) {
                    resolve(result.action === 'confirm' ? 'save' : 'cancel');
                }
            });
        });
    }

    private saveLastOpenedScene_(scenePath: string): void {
        if (!this.projectPath_) return;
        saveEditorLocalSetting(this.projectPath_, 'lastOpenedScene', scenePath);
    }
}
