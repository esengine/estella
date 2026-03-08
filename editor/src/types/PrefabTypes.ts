import type { PrefabOverride } from 'esengine';

export type {
    PrefabData,
    PrefabEntityData,
    PrefabOverride,
    NestedPrefabRef,
} from 'esengine';

export interface PrefabInstanceData {
    prefabPath: string;
    prefabEntityId: number;
    isRoot: boolean;
    instanceId: string;
    overrides: PrefabOverride[];
    basePrefab?: string;
}
