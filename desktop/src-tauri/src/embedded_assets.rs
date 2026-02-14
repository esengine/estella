//! Centralized embedded assets for the editor binary

// =============================================================================
// WASM Modules
// =============================================================================

pub const ENGINE_JS: &[u8] = include_bytes!("../../public/wasm/esengine.js");
pub const ENGINE_WASM: &[u8] = include_bytes!("../../public/wasm/esengine.wasm");
pub const ENGINE_SINGLE_JS: &[u8] = include_bytes!("../../public/wasm/esengine.single.js");
pub const ENGINE_WXGAME_JS: &[u8] = include_bytes!("../../public/wasm/esengine.wxgame.js");
pub const ENGINE_WXGAME_WASM: &[u8] = include_bytes!("../../public/wasm/esengine.wxgame.wasm");
pub const SPINE38_JS: &[u8] = include_bytes!("../../public/wasm/spine38.js");
pub const SPINE38_WASM: &[u8] = include_bytes!("../../public/wasm/spine38.wasm");
pub const SPINE41_JS: &[u8] = include_bytes!("../../public/wasm/spine41.js");
pub const SPINE41_WASM: &[u8] = include_bytes!("../../public/wasm/spine41.wasm");
pub const SPINE42_JS: &[u8] = include_bytes!("../../public/wasm/spine42.js");
pub const SPINE42_WASM: &[u8] = include_bytes!("../../public/wasm/spine42.wasm");
pub const PHYSICS_JS: &[u8] = include_bytes!("../../public/wasm/physics.js");
pub const PHYSICS_WASM: &[u8] = include_bytes!("../../public/wasm/physics.wasm");

// =============================================================================
// SDK
// =============================================================================

pub const SDK_ESM_JS: &[u8] = include_bytes!("../../public/sdk/esm/esengine.js");
pub const SDK_ESM_DTS: &[u8] = include_bytes!("../../public/sdk/esm/esengine.d.ts");
pub const SDK_ESM_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/index.js.map");
pub const SDK_WASM_JS: &[u8] = include_bytes!("../../public/sdk/esm/wasm.js");
pub const SDK_WASM_DTS: &[u8] = include_bytes!("../../public/sdk/esm/wasm.d.ts");
pub const SDK_WASM_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/wasm.js.map");
pub const SDK_SPINE_JS: &[u8] = include_bytes!("../../public/sdk/esm/spine/index.js");
pub const SDK_SPINE_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/spine/index.js.map");
pub const SDK_WECHAT_JS: &[u8] = include_bytes!("../../public/sdk/cjs/esengine.wechat.js");

// =============================================================================
// Editor Types
// =============================================================================

pub const EDITOR_DTS: &[u8] = include_bytes!("../../../editor/dist/index.d.ts");

// =============================================================================
// Preview HTML
// =============================================================================

pub const PREVIEW_HTML: &str = include_str!("preview_template.html");
