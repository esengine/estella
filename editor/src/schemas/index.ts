/**
 * @file    index.ts
 * @brief   Component schemas exports
 */

export {
    type ComponentSchema,
    registerComponentSchema,
    getComponentSchema,
    getAllComponentSchemas,
} from './ComponentSchemas';

export { TransformSchema, CameraSchema } from '../plugins/coreComponents';
export { SpriteSchema } from '../plugins/sprite';
export { TextSchema } from '../plugins/text';
