//! Manifest-driven engine source synchronization.

use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::toolchain::strip_unc_prefix;

// =============================================================================
// Types
// =============================================================================

#[derive(Debug, Deserialize)]
struct ToolchainManifest {
    engine: EngineManifest,
    third_party: ThirdPartyManifest,
}

#[derive(Debug, Deserialize)]
struct EngineManifest {
    root_files: Vec<String>,
    directories: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ThirdPartyManifest {
    root_files: Vec<String>,
    full: Vec<String>,
    partial: HashMap<String, Vec<String>>,
}

// =============================================================================
// Public API
// =============================================================================

pub fn resolve_engine_src(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;

    let engine_src = strip_unc_prefix(resource_dir.join("toolchain/engine-src"));
    if engine_src.exists() {
        return Ok(engine_src);
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|root| root.join("desktop/src-tauri/toolchain/engine-src"));

    if let Some(path) = dev_path {
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Engine source not found. Rebuild the editor.".to_string())
}

pub fn sync_engine_src_if_needed(engine_src: &Path) -> Result<bool, String> {
    let root = match project_root() {
        Some(r) => r,
        None => return Ok(false),
    };

    let manifest = match load_manifest(&root) {
        Ok(m) => m,
        Err(_) => return Ok(false),
    };

    let current_hash = compute_manifest_hash(&root, &manifest);
    let hash_file = engine_src.join(".sync_hash");
    let stored_hash = std::fs::read_to_string(&hash_file).unwrap_or_default();

    if current_hash == stored_hash {
        return Ok(false);
    }

    sync_from_manifest(&root, engine_src, &manifest)?;
    let _ = std::fs::write(&hash_file, &current_hash);
    Ok(true)
}

// =============================================================================
// Internals
// =============================================================================

fn project_root() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
}

fn load_manifest(root: &Path) -> Result<ToolchainManifest, String> {
    let path = root.join("toolchain.manifest.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read toolchain manifest: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse toolchain manifest: {}", e))
}

fn compute_manifest_hash(root: &Path, manifest: &ToolchainManifest) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::Hasher;

    let mut hasher = DefaultHasher::new();

    for file in &manifest.engine.root_files {
        hash_file_meta(&mut hasher, &root.join(file));
    }
    for dir in &manifest.engine.directories {
        hash_dir_meta(&mut hasher, &root.join(dir));
    }
    for file in &manifest.third_party.root_files {
        hash_file_meta(&mut hasher, &root.join("third_party").join(file));
    }
    for dir in &manifest.third_party.full {
        hash_file_meta(&mut hasher, &root.join("third_party").join(dir).join("CMakeLists.txt"));
    }
    for (lib, subdirs) in &manifest.third_party.partial {
        for subdir in subdirs {
            hash_dir_meta(&mut hasher, &root.join("third_party").join(lib).join(subdir));
        }
    }

    format!("{:016x}", hasher.finish())
}

pub fn hash_file_meta(hasher: &mut impl std::hash::Hasher, path: &Path) {
    use std::hash::Hash;
    if let Ok(meta) = std::fs::metadata(path) {
        path.to_string_lossy().hash(hasher);
        meta.len().hash(hasher);
        if let Ok(modified) = meta.modified() {
            modified.hash(hasher);
        }
    }
}

pub fn hash_dir_meta(hasher: &mut impl std::hash::Hasher, dir: &Path) {
    if let Ok(entries) = collect_all_files(dir) {
        for path in entries {
            hash_file_meta(hasher, &path);
        }
    }
}

fn sync_from_manifest(root: &Path, dest: &Path, manifest: &ToolchainManifest) -> Result<(), String> {
    let hash_backup = std::fs::read_to_string(dest.join(".sync_hash")).ok();

    if dest.exists() {
        std::fs::remove_dir_all(dest).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;

    if let Some(hash) = hash_backup {
        let _ = std::fs::write(dest.join(".sync_hash"), hash);
    }

    for file in &manifest.engine.root_files {
        let src = root.join(file);
        if src.exists() {
            std::fs::copy(&src, dest.join(file)).map_err(|e| e.to_string())?;
        }
    }

    for dir in &manifest.engine.directories {
        let src = root.join(dir);
        if src.exists() {
            copy_dir_recursive(&src, &dest.join(dir))?;
        }
    }

    let tp_dest = dest.join("third_party");
    std::fs::create_dir_all(&tp_dest).map_err(|e| e.to_string())?;

    for file in &manifest.third_party.root_files {
        let src = root.join("third_party").join(file);
        if src.exists() {
            std::fs::copy(&src, tp_dest.join(file)).map_err(|e| e.to_string())?;
        }
    }

    for dir in &manifest.third_party.full {
        let src = root.join("third_party").join(dir);
        if src.exists() {
            copy_dir_recursive(&src, &tp_dest.join(dir))?;
        }
    }

    for (lib, subdirs) in &manifest.third_party.partial {
        for subdir in subdirs {
            let src = root.join("third_party").join(lib).join(subdir);
            if src.exists() {
                copy_dir_recursive(&src, &tp_dest.join(lib).join(subdir))?;
            }
        }
    }

    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            std::fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn collect_all_files(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut files = Vec::new();
    if !dir.is_dir() {
        return Ok(files);
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            files.extend(collect_all_files(&path)?);
        } else {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}
