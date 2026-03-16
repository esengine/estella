//! Toolchain management and WASM compilation.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// =============================================================================
// Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainStatus {
    pub installed: bool,
    pub emsdk_path: Option<String>,
    pub emscripten_version: Option<String>,
    pub emscripten_ok: bool,
    pub cmake_found: bool,
    pub cmake_version: Option<String>,
    pub cmake_ok: bool,
    pub python_found: bool,
    pub python_version: Option<String>,
    pub python_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFlags {
    pub tilemap: bool,
    pub particles: bool,
    pub timeline: bool,
    pub postprocess: bool,
    pub bitmap_text: bool,
    pub spine: bool,
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            tilemap: true,
            particles: true,
            timeline: true,
            postprocess: true,
            bitmap_text: true,
            spine: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileOptions {
    pub features: FeatureFlags,
    pub target: String,
    pub debug: bool,
    pub optimization: String,
    #[serde(default)]
    pub enable_physics: bool,
    #[serde(default)]
    pub spine_versions: Vec<String>,
    #[serde(default)]
    pub clean_build: bool,
}

impl Default for CompileOptions {
    fn default() -> Self {
        Self {
            features: FeatureFlags::default(),
            target: "web".to_string(),
            debug: false,
            optimization: "-Oz".to_string(),
            enable_physics: false,
            spine_versions: Vec::new(),
            clean_build: false,
        }
    }
}

#[derive(Clone, Serialize)]
struct CompileProgress {
    stage: String,
    message: String,
    progress: f32,
}

#[derive(Serialize)]
pub struct SpineModuleResult {
    pub version: String,
    pub js_path: String,
    pub wasm_path: String,
}

#[derive(Serialize)]
pub struct CompileResult {
    pub success: bool,
    pub wasm_path: Option<String>,
    pub js_path: Option<String>,
    pub wasm_size: Option<u64>,
    pub error: Option<String>,
    pub cache_key: String,
    pub spine_modules: Vec<SpineModuleResult>,
    pub physics_js_path: Option<String>,
    pub physics_wasm_path: Option<String>,
}

const EMSDK_VERSION: &str = "5.0.0";
const EMSDK_DOWNLOAD_BASE: &str = "https://github.com/esengine/emsdk-releases/releases/download";

const MIN_EMSCRIPTEN_VERSION: &str = "5.0.0";
const MIN_CMAKE_VERSION: &str = "3.16";
const MIN_PYTHON_VERSION: &str = "3.0";

fn toolchain_archive_url() -> String {
    let (os, ext) = if cfg!(target_os = "windows") {
        ("win", "zip")
    } else if cfg!(target_os = "macos") {
        ("mac", "tar.gz")
    } else {
        ("linux", "tar.gz")
    };
    format!(
        "{}/v{}/emsdk-{}-{}.{}",
        EMSDK_DOWNLOAD_BASE, EMSDK_VERSION, EMSDK_VERSION, os, ext
    )
}

fn version_ge(actual: &str, required: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.')
            .filter_map(|p| p.trim().parse::<u32>().ok())
            .collect()
    };
    let a = parse(actual);
    let r = parse(required);
    for i in 0..r.len() {
        let av = a.get(i).copied().unwrap_or(0);
        let rv = r[i];
        if av > rv { return true; }
        if av < rv { return false; }
    }
    true
}

// =============================================================================
// Toolchain settings persistence
// =============================================================================

fn toolchain_config_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("toolchain.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ToolchainConfig {
    emsdk_path: Option<String>,
}

fn load_config(app: &AppHandle) -> ToolchainConfig {
    let path = toolchain_config_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, config: &ToolchainConfig) -> Result<(), String> {
    let path = toolchain_config_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// =============================================================================
// Toolchain discovery
// =============================================================================

fn find_emcc_in_emsdk(emsdk_path: &Path) -> Option<PathBuf> {
    let emcc = emsdk_path.join("upstream/emscripten/emcc");
    if emcc.exists() {
        return Some(emcc);
    }
    let emcc_bat = emsdk_path.join("upstream/emscripten/emcc.bat");
    if emcc_bat.exists() {
        return Some(emcc_bat);
    }
    None
}

fn validate_emsdk(emsdk_path: &Path) -> bool {
    find_emcc_in_emsdk(emsdk_path).is_some()
}

fn get_emcc_version(emsdk_path: &Path) -> Option<String> {
    let emcc = find_emcc_in_emsdk(emsdk_path)?;
    let output = std::process::Command::new(&emcc)
        .arg("--version")
        .env("EMSDK", emsdk_path)
        .env(
            "EM_CONFIG",
            emsdk_path.join(".emscripten"),
        )
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let re_version = stdout
        .lines()
        .find_map(|line| {
            line.split_whitespace()
                .find(|w| w.chars().next().map_or(false, |c| c.is_ascii_digit()))
        })
        .map(|s| s.trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.').to_string());
    re_version
}

fn find_bundled_cmake(app: &AppHandle) -> Option<PathBuf> {
    let cmake_name = if cfg!(windows) { "cmake.exe" } else { "cmake" };

    // Bundled in resources
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("toolchain/cmake/bin").join(cmake_name);
        if bundled.exists() {
            return Some(bundled);
        }
    }

    // Dev mode fallback
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("toolchain/cmake/bin")
        .join(cmake_name);
    if dev_path.exists() {
        return Some(dev_path);
    }

    None
}

fn find_cmake(app: &AppHandle) -> Option<(PathBuf, String)> {
    // Prefer bundled cmake
    if let Some(bundled) = find_bundled_cmake(app) {
        let output = std::process::Command::new(&bundled)
            .arg("--version")
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let version = stdout.lines().next()?.split_whitespace().last()?.to_string();
        return Some((bundled, version));
    }

    // Fall back to system cmake
    let cmake = if cfg!(windows) { "cmake.exe" } else { "cmake" };
    let output = std::process::Command::new(cmake)
        .arg("--version")
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout
        .lines()
        .next()?
        .split_whitespace()
        .last()?
        .to_string();

    let path = which_sync(cmake)?;
    Some((path, version))
}

fn find_python() -> Option<(PathBuf, String)> {
    for bin in &["python3", "python"] {
        let output = std::process::Command::new(bin)
            .arg("--version")
            .output()
            .ok();
        if let Some(out) = output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);
                let text = if stdout.contains("Python") { stdout } else { stderr };
                let version = text
                    .trim()
                    .strip_prefix("Python ")
                    .unwrap_or(text.trim())
                    .to_string();
                if let Some(path) = which_sync(bin) {
                    return Some((path, version));
                }
            }
        }
    }
    None
}

fn find_emsdk_python(emsdk_path: &Path) -> Option<(PathBuf, String)> {
    // emsdk bundles Python at <emsdk>/python/<version>/bin/python3
    let python_dir = emsdk_path.join("python");
    if !python_dir.exists() {
        return None;
    }
    let entries = std::fs::read_dir(&python_dir).ok()?;
    for entry in entries.flatten() {
        let python_bin = if cfg!(windows) {
            // Windows: <emsdk>/python/<version>/python.exe (no bin subdirectory)
            entry.path().join("python.exe")
        } else {
            entry.path().join("bin").join("python3")
        };
        if python_bin.exists() {
            let output = std::process::Command::new(&python_bin)
                .arg("--version")
                .output()
                .ok()?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout
                .trim()
                .strip_prefix("Python ")
                .unwrap_or(stdout.trim())
                .to_string();
            return Some((python_bin, version));
        }
    }
    None
}

fn which_sync(bin: &str) -> Option<PathBuf> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = std::process::Command::new(cmd)
        .arg(bin)
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = stdout.lines().next()?.trim();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

fn resolve_engine_src(app: &AppHandle) -> Result<PathBuf, String> {
    // Bundled engine source in resources
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;

    let engine_src = resource_dir.join("toolchain/engine-src");
    if engine_src.exists() {
        return Ok(engine_src);
    }

    // Dev mode fallback
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

fn auto_detect_emsdk(app: &AppHandle) -> Option<PathBuf> {
    // 1. Find emcc via PATH, derive emsdk root (emcc lives at <emsdk>/upstream/emscripten/emcc)
    let emcc_bin = if cfg!(windows) { "emcc.bat" } else { "emcc" };
    if let Some(emcc_path) = which_sync(emcc_bin) {
        if let Some(emsdk_root) = emcc_path.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            if validate_emsdk(emsdk_root) {
                return Some(emsdk_root.to_path_buf());
            }
        }
    }

    // 2. EMSDK environment variable
    if let Ok(emsdk_env) = std::env::var("EMSDK") {
        let path = PathBuf::from(&emsdk_env);
        if validate_emsdk(&path) {
            return Some(path);
        }
    }

    // 3. Our own install location (from "Install emsdk" button)
    let own_install = default_emsdk_install_path(app);
    if validate_emsdk(&own_install) {
        return Some(own_install);
    }

    None
}

fn default_emsdk_install_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("emsdk")
}

// =============================================================================
// Tauri commands
// =============================================================================

#[tauri::command]
pub fn get_toolchain_status(app: AppHandle) -> ToolchainStatus {
    let mut config = load_config(&app);

    let (emsdk_path, emscripten_version) = config
        .emsdk_path
        .as_ref()
        .and_then(|p| {
            let path = PathBuf::from(p);
            if validate_emsdk(&path) {
                let version = get_emcc_version(&path);
                Some((Some(p.clone()), version))
            } else {
                None
            }
        })
        .or_else(|| {
            let detected = auto_detect_emsdk(&app)?;
            let version = get_emcc_version(&detected);
            let path_str = detected.to_string_lossy().to_string();

            config.emsdk_path = Some(path_str.clone());
            let _ = save_config(&app, &config);

            Some((Some(path_str), version))
        })
        .unwrap_or((None, None));

    let (cmake_found, cmake_version) = find_cmake(&app)
        .map(|(_, v)| (true, Some(v)))
        .unwrap_or((false, None));

    let python_from_emsdk = emsdk_path.as_ref().and_then(|p| find_emsdk_python(&PathBuf::from(p)));
    let (python_found, python_version) = python_from_emsdk
        .map(|(_, v)| (true, Some(v)))
        .or_else(|| find_python().map(|(_, v)| (true, Some(v))))
        .unwrap_or((false, None));

    let emscripten_ok = emscripten_version
        .as_deref()
        .map_or(false, |v| version_ge(v, MIN_EMSCRIPTEN_VERSION));
    let cmake_ok = cmake_version
        .as_deref()
        .map_or(false, |v| version_ge(v, MIN_CMAKE_VERSION));
    let python_ok = python_version
        .as_deref()
        .map_or(false, |v| version_ge(v, MIN_PYTHON_VERSION));

    ToolchainStatus {
        installed: emscripten_ok && cmake_ok && python_ok,
        emsdk_path,
        emscripten_version,
        emscripten_ok,
        cmake_found,
        cmake_version,
        cmake_ok,
        python_found,
        python_version,
        python_ok,
    }
}

#[tauri::command]
pub fn set_emsdk_path(app: AppHandle, path: String) -> Result<ToolchainStatus, String> {
    let emsdk_path = PathBuf::from(&path);
    if !validate_emsdk(&emsdk_path) {
        return Err(format!(
            "Invalid emsdk directory: emcc not found at {}/upstream/emscripten/emcc",
            path
        ));
    }

    let mut config = load_config(&app);
    config.emsdk_path = Some(path);
    save_config(&app, &config)?;

    Ok(get_toolchain_status(app))
}

#[tauri::command]
pub async fn install_emsdk(app: AppHandle) -> Result<ToolchainStatus, String> {
    let install_dir = default_emsdk_install_path(&app);
    let install_dir_str = install_dir.to_string_lossy().to_string();
    let url = toolchain_archive_url();
    let is_zip = url.ends_with(".zip");

    emit_progress(&app, "download", "Downloading toolchain...", 0.05);

    // Download archive with progress
    let archive_data = download_with_progress(&app, &url).await?;

    // Clean previous install
    if install_dir.exists() {
        std::fs::remove_dir_all(&install_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;

    emit_progress(&app, "extract", "Extracting toolchain...", 0.7);

    // Extract archive
    let target = install_dir.clone();
    tokio::task::spawn_blocking(move || {
        if is_zip {
            extract_zip(&archive_data, &target)
        } else {
            extract_tar_gz(&archive_data, &target)
        }
    })
    .await
    .map_err(|e| format!("Extract task failed: {}", e))??;

    // Generate .emscripten config
    emit_progress(&app, "configure", "Configuring emscripten...", 0.9);
    generate_emscripten_config(&install_dir)?;

    emit_progress(&app, "complete", "Toolchain installed!", 1.0);

    // Save path
    let mut config = load_config(&app);
    config.emsdk_path = Some(install_dir_str);
    save_config(&app, &config)?;

    Ok(get_toolchain_status(app))
}

async fn download_with_progress(app: &AppHandle, url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut data = Vec::with_capacity(total_size as usize);
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download interrupted: {}", e))?;
        data.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let pct = (downloaded as f32 / total_size as f32).min(0.65);
            let size_mb = downloaded as f32 / 1_048_576.0;
            let total_mb = total_size as f32 / 1_048_576.0;
            emit_progress(
                app,
                "download",
                &format!("Downloading toolchain... {:.0}/{:.0} MB", size_mb, total_mb),
                0.05 + pct,
            );
        }
    }

    Ok(data)
}

fn generate_emscripten_config(emsdk_dir: &Path) -> Result<(), String> {
    let upstream = emsdk_dir.join("upstream");
    let emscripten = upstream.join("emscripten");
    let node_dir = emsdk_dir.join("node");

    let node_bin = if cfg!(windows) {
        find_first_subdir(&node_dir)
            .map(|d| d.join("bin").join("node.exe"))
            .unwrap_or_else(|| node_dir.join("bin").join("node.exe"))
    } else {
        find_first_subdir(&node_dir)
            .map(|d| d.join("bin").join("node"))
            .unwrap_or_else(|| node_dir.join("bin").join("node"))
    };

    let to_python_path = |p: &Path| -> String {
        let s = p.to_string_lossy().replace('\\', "/");
        format!("'{}'", s)
    };

    let config = format!(
        "import os\nEMSCRIPTEN_ROOT = {}\nLLVM_ROOT = {}\nBINARYEN_ROOT = {}\nNODE_JS = {}\n",
        to_python_path(&emscripten),
        to_python_path(&upstream.join("bin")),
        to_python_path(&upstream),
        to_python_path(&node_bin),
    );

    let config_path = emsdk_dir.join(".emscripten");
    std::fs::write(&config_path, config)
        .map_err(|e| format!("Failed to write .emscripten config: {}", e))?;

    Ok(())
}

fn find_first_subdir(dir: &Path) -> Option<std::path::PathBuf> {
    if !dir.exists() {
        return None;
    }
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .find(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
}

fn extract_zip(data: &[u8], target: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid zip: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        // Strip the top-level directory (e.g., "emsdk-5.0.0-win/")
        let relative = strip_top_dir(&name);
        if relative.is_empty() {
            continue;
        }

        let out_path = target.join(relative);

        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode))
                        .ok();
                }
            }
        }
    }
    Ok(())
}

fn extract_tar_gz(data: &[u8], target: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(data);
    let gz = flate2::read::GzDecoder::new(cursor);
    let mut archive = tar::Archive::new(gz);

    // Unpack stripping the top-level directory
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let path_str = path.to_string_lossy().to_string();

        let relative = strip_top_dir(&path_str);
        if relative.is_empty() {
            continue;
        }

        let out_path = target.join(relative);

        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = entry.header().mode().ok() {
                    std::fs::set_permissions(
                        &out_path,
                        std::fs::Permissions::from_mode(mode),
                    )
                    .ok();
                }
            }
        }
    }
    Ok(())
}

fn strip_top_dir(path: &str) -> &str {
    // "emsdk-5.0.0-mac/upstream/emscripten/emcc" → "upstream/emscripten/emcc"
    match path.find('/') {
        Some(idx) => &path[idx + 1..],
        None => "",
    }
}

#[tauri::command]
pub async fn compile_wasm(
    app: AppHandle,
    options: CompileOptions,
) -> Result<CompileResult, String> {
    let config = load_config(&app);
    let emsdk_path = config
        .emsdk_path
        .ok_or("emsdk not configured. Set the path or install it first.")?;
    let emsdk_dir = PathBuf::from(&emsdk_path);

    if !validate_emsdk(&emsdk_dir) {
        return Err(format!("Invalid emsdk at: {}", emsdk_path));
    }

    if !emsdk_dir.join(".emscripten").exists() {
        generate_emscripten_config(&emsdk_dir)?;
    }

    let engine_src = resolve_engine_src(&app)?;
    let cache_key = compute_cache_key(&options);

    // Build directory
    let build_base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("build-cache");
    let build_dir = build_base.join(&cache_key);

    if options.clean_build && build_dir.exists() {
        emit_progress(&app, "configure", "Cleaning build cache...", 0.05);
        std::fs::remove_dir_all(&build_dir).map_err(|e| e.to_string())?;
    }

    std::fs::create_dir_all(&build_dir).map_err(|e| e.to_string())?;

    // Check cache
    if !options.clean_build {
        let wasm_output = if options.target == "playable" {
            build_dir.join("sdk/esengine.single.js")
        } else {
            build_dir.join("sdk/esengine-core.wasm")
        };

        if wasm_output.exists() {
            emit_progress(&app, "complete", "Using cached build", 1.0);
            return Ok(make_result(true, &build_dir, &cache_key, &options));
        }
    }

    let env_vars = build_env_vars(&emsdk_dir, &app);

    // Resolve cmake binary (bundled or system)
    let cmake_bin = find_bundled_cmake(&app)
        .or_else(|| which_sync(if cfg!(windows) { "cmake.exe" } else { "cmake" }))
        .ok_or("cmake not found. Run toolchain packaging first.")?;
    let cmake_str = cmake_bin.to_string_lossy().to_string();

    // Configure
    emit_progress(&app, "configure", "Configuring CMake...", 0.1);

    let emcmake_name = if cfg!(windows) { "emcmake.bat" } else { "emcmake" };
    let emcmake = emsdk_dir.join("upstream/emscripten").join(emcmake_name);
    let mut cmake_args = vec![cmake_str.clone()];
    cmake_args.extend(build_cmake_flags(&options));
    cmake_args.push(engine_src.to_string_lossy().to_string());

    run_command_streamed(
        &app,
        emcmake.to_string_lossy().as_ref(),
        &cmake_args,
        &build_dir,
        &env_vars,
    )
    .await?;

    // Build
    emit_progress(&app, "compile", "Compiling C++ to WASM...", 0.3);

    let build_target = match options.target.as_str() {
        "wechat" => "esengine_wxgame",
        "playable" => "esengine_single",
        _ => "esengine_sdk",
    };

    run_command_streamed(
        &app,
        &cmake_str,
        &[
            "--build".to_string(),
            ".".to_string(),
            "-j".to_string(),
            num_cpus().to_string(),
            "--target".to_string(),
            build_target.to_string(),
        ],
        &build_dir,
        &env_vars,
    )
    .await?;

    // Build spine modules
    if options.features.spine && !options.spine_versions.is_empty() {
        emit_progress(&app, "compile", "Compiling Spine modules...", 0.5);
        for version in &options.spine_versions {
            let cmake_target = match version.as_str() {
                "3.8" => "spine_module_38",
                "4.1" => "spine_module_41",
                "4.2" => "spine_module",
                _ => continue,
            };
            run_command_streamed(
                &app,
                &cmake_str,
                &[
                    "--build".to_string(),
                    ".".to_string(),
                    "-j".to_string(),
                    num_cpus().to_string(),
                    "--target".to_string(),
                    cmake_target.to_string(),
                ],
                &build_dir,
                &env_vars,
            )
            .await?;
        }
    }

    // Build physics module (only if box2d source is available)
    if options.enable_physics {
        let box2d_dir = engine_src.join("third_party/box2d");
        if box2d_dir.exists() {
            emit_progress(&app, "compile", "Compiling Physics module...", 0.65);
            run_command_streamed(
                &app,
                &cmake_str,
                &[
                    "--build".to_string(),
                    ".".to_string(),
                    "-j".to_string(),
                    num_cpus().to_string(),
                    "--target".to_string(),
                    "physics_module".to_string(),
                ],
                &build_dir,
                &env_vars,
            )
            .await?;
        } else {
            emit_progress(&app, "compile", "Physics module skipped (box2d not bundled)", 0.65);
        }
    }

    // Optimize
    if !options.debug {
        emit_progress(&app, "optimize", "Optimizing WASM...", 0.8);

        let wasm_opt = if cfg!(windows) {
            emsdk_dir.join("upstream/bin/wasm-opt.exe")
        } else {
            emsdk_dir.join("upstream/bin/wasm-opt")
        };
        let wasm_file = build_dir.join("sdk/esengine-core.wasm");

        if wasm_opt.exists() && wasm_file.exists() {
            let wasm_path = wasm_file.to_string_lossy().to_string();
            if let Err(e) = run_command_streamed(
                &app,
                wasm_opt.to_string_lossy().as_ref(),
                &[
                    options.optimization.clone(),
                    "--enable-bulk-memory".to_string(),
                    "--enable-nontrapping-float-to-int".to_string(),
                    "-o".to_string(),
                    wasm_path.clone(),
                    wasm_path,
                ],
                &build_dir,
                &env_vars,
            )
            .await
            {
                emit_progress(&app, "warning", &format!("wasm-opt failed (non-fatal): {}", e), 0.85);
            }
        }
    }

    emit_progress(&app, "complete", "Build complete!", 1.0);

    Ok(make_result(true, &build_dir, &cache_key, &options))
}

#[tauri::command]
pub fn clear_build_cache(app: AppHandle) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("build-cache");
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// =============================================================================
// Helpers
// =============================================================================

fn make_result(success: bool, build_dir: &Path, cache_key: &str, options: &CompileOptions) -> CompileResult {
    let (js_name, wasm_name) = if options.target == "playable" {
        ("sdk/esengine.single.js", None)
    } else {
        ("sdk/esengine-core.js", Some("sdk/esengine-core.wasm"))
    };

    let js_path = build_dir.join(js_name);
    let wasm_path = wasm_name.map(|n| build_dir.join(n));

    let size_path = wasm_path.as_ref().unwrap_or(&js_path);
    let wasm_size = std::fs::metadata(size_path).map(|m| m.len()).ok();

    let mut spine_modules = Vec::new();
    if options.features.spine {
        for version in &options.spine_versions {
            let tag = version.replace('.', "");
            let sjs = build_dir.join(format!("sdk/spine{tag}.js"));
            let swasm = build_dir.join(format!("sdk/spine{tag}.wasm"));
            if sjs.exists() && swasm.exists() {
                spine_modules.push(SpineModuleResult {
                    version: version.clone(),
                    js_path: sjs.to_string_lossy().to_string(),
                    wasm_path: swasm.to_string_lossy().to_string(),
                });
            }
        }
    }

    let (physics_js_path, physics_wasm_path) = if options.enable_physics {
        let pjs = build_dir.join("sdk/physics.js");
        let pwasm = build_dir.join("sdk/physics.wasm");
        (
            pjs.exists().then(|| pjs.to_string_lossy().to_string()),
            pwasm.exists().then(|| pwasm.to_string_lossy().to_string()),
        )
    } else {
        (None, None)
    };

    CompileResult {
        success,
        js_path: js_path.exists().then(|| js_path.to_string_lossy().to_string()),
        wasm_path: wasm_path.and_then(|p| {
            p.exists().then(|| p.to_string_lossy().to_string())
        }),
        wasm_size,
        error: None,
        cache_key: cache_key.to_string(),
        spine_modules,
        physics_js_path,
        physics_wasm_path,
    }
}

fn compute_cache_key(options: &CompileOptions) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    let f = &options.features;
    f.tilemap.hash(&mut hasher);
    f.particles.hash(&mut hasher);
    f.timeline.hash(&mut hasher);
    f.postprocess.hash(&mut hasher);
    f.bitmap_text.hash(&mut hasher);
    f.spine.hash(&mut hasher);
    options.target.hash(&mut hasher);
    options.debug.hash(&mut hasher);
    options.optimization.hash(&mut hasher);
    options.enable_physics.hash(&mut hasher);
    options.spine_versions.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn build_cmake_flags(options: &CompileOptions) -> Vec<String> {
    let mut flags = vec![
        format!(
            "-DCMAKE_BUILD_TYPE={}",
            if options.debug { "Debug" } else { "Release" }
        ),
        "-DES_BUILD_WEB=ON".to_string(),
        "-DES_BUILD_TESTS=OFF".to_string(),
    ];

    let feature_map = [
        ("ES_ENABLE_TILEMAP", options.features.tilemap),
        ("ES_ENABLE_PARTICLES", options.features.particles),
        ("ES_ENABLE_TIMELINE", options.features.timeline),
        ("ES_ENABLE_POSTPROCESS", options.features.postprocess),
        ("ES_ENABLE_BITMAP_TEXT", options.features.bitmap_text),
        ("ES_ENABLE_SPINE", options.features.spine),
    ];

    for (flag, enabled) in feature_map {
        flags.push(format!("-D{}={}", flag, if enabled { "ON" } else { "OFF" }));
    }

    if !options.debug {
        flags.push(format!("-DCMAKE_C_FLAGS={}", options.optimization));
        flags.push(format!("-DCMAKE_CXX_FLAGS={}", options.optimization));
        flags.push("-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON".to_string());
    }

    match options.target.as_str() {
        "wechat" => {
            flags.retain(|f| f != "-DES_BUILD_WEB=ON");
            flags.push("-DES_BUILD_WXGAME=ON".to_string());
        }
        "playable" => {
            flags.push("-DES_BUILD_SINGLE_FILE=ON".to_string());
        }
        _ => {}
    }

    flags
}

fn build_env_vars(emsdk_dir: &Path, app: &AppHandle) -> HashMap<String, String> {
    let mut env = HashMap::new();

    let upstream_dir = emsdk_dir.join("upstream");
    let emscripten_dir = upstream_dir.join("emscripten");

    env.insert("EMSDK".to_string(), emsdk_dir.to_string_lossy().to_string());
    env.insert(
        "EM_CONFIG".to_string(),
        emsdk_dir.join(".emscripten").to_string_lossy().to_string(),
    );

    // Use emsdk-bundled Python so users don't need system Python
    if let Some((python_path, _)) = find_emsdk_python(emsdk_dir) {
        env.insert("EMSDK_PYTHON".to_string(), python_path.to_string_lossy().to_string());
    }

    let path_sep = if cfg!(windows) { ";" } else { ":" };
    let system_path = std::env::var("PATH").unwrap_or_default();

    let mut path_entries = vec![
        emscripten_dir.to_string_lossy().to_string(),
        upstream_dir.join("bin").to_string_lossy().to_string(),
    ];

    // Add bundled cmake to PATH
    if let Some(bundled_cmake) = find_bundled_cmake(app) {
        if let Some(cmake_bin_dir) = bundled_cmake.parent() {
            path_entries.push(cmake_bin_dir.to_string_lossy().to_string());
        }
    }

    path_entries.push(system_path);
    env.insert("PATH".to_string(), path_entries.join(path_sep));
    env
}

fn emit_progress(app: &AppHandle, stage: &str, message: &str, progress: f32) {
    let _ = app.emit(
        "compile-progress",
        CompileProgress {
            stage: stage.to_string(),
            message: message.to_string(),
            progress,
        },
    );
}

async fn run_command_streamed(
    app: &AppHandle,
    cmd: &str,
    args: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
) -> Result<(), String> {
    let mut command = Command::new(cmd);
    command
        .args(args)
        .current_dir(cwd)
        .envs(env)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        format!("Failed to spawn {}: {} (cwd: {})", cmd, e, cwd.display())
    })?;

    let stdout = child.stdout.take().ok_or(format!("Failed to capture stdout for: {}", cmd))?;
    let stderr = child.stderr.take().ok_or(format!("Failed to capture stderr for: {}", cmd))?;

    let app_out = app.clone();
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit(
                "compile-output",
                super::CommandOutput {
                    stream: "stdout".to_string(),
                    data: line,
                },
            );
        }
    });

    let app_err = app.clone();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit(
                "compile-output",
                super::CommandOutput {
                    stream: "stderr".to_string(),
                    data: line,
                },
            );
        }
    });

    let _ = tokio::join!(stdout_handle, stderr_handle);

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!(
            "Command failed: {} (exit code: {})",
            cmd,
            status.code().unwrap_or(-1)
        ));
    }

    Ok(())
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}
