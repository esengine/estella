/**
 * @file    index.ts
 * @brief   Launcher module exports
 */

export { ProjectLauncher } from './ProjectLauncher';
export type { ProjectLauncherOptions } from './ProjectLauncher';

export { NewProjectDialog } from './NewProjectDialog';
export type { NewProjectDialogOptions } from './NewProjectDialog';

export {
    createProject,
    openProject,
    openProjectDialog,
    selectProjectLocation,
    getRecentProjects,
    addRecentProject,
    removeRecentProject,
    clearRecentProjects,
    loadProjectConfig,
} from './ProjectService';
export type { CreateProjectOptions, ProjectServiceResult } from './ProjectService';

