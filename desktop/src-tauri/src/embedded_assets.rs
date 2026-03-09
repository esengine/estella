//! Centralized embedded assets for the editor binary

// =============================================================================
// WASM Modules
// =============================================================================

// Editor runtime only — build assets are compiled dynamically via toolchain
pub const ENGINE_JS: &[u8] = include_bytes!("../../public/wasm/esengine.js");
pub const ENGINE_WASM: &[u8] = include_bytes!("../../public/wasm/esengine.wasm");

// =============================================================================
// ESBuild
// =============================================================================

pub const ESBUILD_WASM: &[u8] = include_bytes!("../../public/esbuild.wasm");

// =============================================================================
// SDK
// =============================================================================

pub const SDK_ESM_JS: &[u8] = include_bytes!("../../public/sdk/esm/esengine.bundled.js");
pub const SDK_ESM_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/esengine.bundled.js.map");
pub const SDK_ESM_DTS: &[u8] = include_bytes!("../../public/sdk/esm/esengine.d.ts");
pub const SDK_WASM_JS: &[u8] = include_bytes!("../../public/sdk/esm/wasm.js");
pub const SDK_WASM_DTS: &[u8] = include_bytes!("../../public/sdk/esm/wasm.d.ts");
pub const SDK_WASM_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/wasm.js.map");
pub const SDK_SPINE_JS: &[u8] = include_bytes!("../../public/sdk/esm/spine/index.js");
pub const SDK_SPINE_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/spine/index.js.map");
pub const SDK_SHARED_INDEX_JS: &[u8] = include_bytes!("../../public/sdk/esm/shared/index.js");
pub const SDK_SHARED_INDEX_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/shared/index.js.map");
pub const SDK_SHARED_MATERIAL_JS: &[u8] = include_bytes!("../../public/sdk/esm/shared/material.js");
pub const SDK_SHARED_MATERIAL_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/shared/material.js.map");
pub const SDK_SHARED_SPINEMODULELOADER_JS: &[u8] = include_bytes!("../../public/sdk/esm/shared/SpineModuleLoader.js");
pub const SDK_SHARED_SPINEMODULELOADER_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/shared/SpineModuleLoader.js.map");
pub const SDK_SHARED_WASM_DTS: &[u8] = include_bytes!("../../public/sdk/esm/shared/wasm.d.ts");
pub const SDK_SHARED_APP_DTS: &[u8] = include_bytes!("../../public/sdk/esm/shared/app.d.ts");
pub const SDK_PHYSICS_DTS: &[u8] = include_bytes!("../../public/sdk/esm/physics/index.d.ts");
pub const SDK_SPINE_DTS: &[u8] = include_bytes!("../../public/sdk/esm/spine/index.d.ts");
pub const SDK_WECHAT_JS: &[u8] = include_bytes!("../../public/sdk/cjs/esengine.wechat.js");

// =============================================================================
// Editor Types
// =============================================================================

pub const EDITOR_DTS: &[u8] = include_bytes!("../../../editor/dist/index.d.ts");

// =============================================================================
// Preview HTML
// =============================================================================

pub const PREVIEW_HTML: &str = include_str!("preview_template.html");
