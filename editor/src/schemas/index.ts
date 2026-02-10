/**
 * @file    index.ts
 * @brief   Component schemas exports
 */

export {
    type ComponentSchema,
    LocalTransformSchema,
    SpriteSchema,
    CameraSchema,
    TextSchema,
    registerComponentSchema,
    getComponentSchema,
    getAllComponentSchemas,
    registerBuiltinSchemas,
    registerSpineSchema,
    lockBuiltinComponentSchemas,
    clearExtensionComponentSchemas,
    type BuiltinSchemaOptions,
} from './ComponentSchemas';
