//! Toolchain discovery, configuration, installation, and repair.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
    pub corrupted: bool,
    pub missing_tools: Vec<String>,
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
pub struct CompileProgress {
    pub stage: String,
    pub message: String,
    pub progress: f32,
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

// =============================================================================
// Constants
// =============================================================================

const EMSDK_VERSION: &str = "5.0.0";
const EMSDK_DOWNLOAD_BASE: &str = "https://github.com/esengine/emsdk-releases/releases/download";
const NINJA_VERSION: &str = "1.13.2";

const MIN_EMSCRIPTEN_VERSION: &str = "5.0.0";
const MIN_CMAKE_VERSION: &str = "3.16";
const MIN_PYTHON_VERSION: &str = "3.0";

// =============================================================================
// Toolchain settings persistence
// =============================================================================

pub fn toolchain_config_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("toolchain.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolchainConfig {
    pub emsdk_path: Option<String>,
}

pub fn load_config(app: &AppHandle) -> ToolchainConfig {
    let path = toolchain_config_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_config(app: &AppHandle, config: &ToolchainConfig) -> Result<(), String> {
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

pub fn find_emcc_in_emsdk(emsdk_path: &Path) -> Option<PathBuf> {
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

pub fn validate_emsdk(emsdk_path: &Path) -> bool {
    find_emcc_in_emsdk(emsdk_path).is_some()
}

pub fn validate_emsdk_integrity(emsdk_path: &Path) -> Vec<String> {
    let ninja_name = if cfg!(windows) { "ninja.exe" } else { "ninja" };
    let required = [
        ("upstream/bin", ninja_name, "ninja"),
        ("upstream/emscripten", if cfg!(windows) { "emcc.bat" } else { "emcc" }, "emcc"),
        (".emscripten", "", ".emscripten config"),
    ];

    let mut missing = Vec::new();
    for (dir, file, label) in &required {
        let path = if file.is_empty() {
            emsdk_path.join(dir)
        } else {
            emsdk_path.join(dir).join(file)
        };
        if !path.exists() {
            missing.push(label.to_string());
        }
    }
    missing
}

pub fn get_emcc_version(emsdk_path: &Path) -> Option<String> {
    let emcc = find_emcc_in_emsdk(emsdk_path)?;
    let output = silent_command(&emcc)
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

pub fn find_bundled_cmake(app: &AppHandle) -> Option<PathBuf> {
    let cmake_name = if cfg!(windows) { "cmake.exe" } else { "cmake" };

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = strip_unc_prefix(resource_dir.join("toolchain/cmake/bin").join(cmake_name));
        if bundled.exists() {
            return Some(bundled);
        }
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("toolchain/cmake/bin")
        .join(cmake_name);
    if dev_path.exists() {
        return Some(dev_path);
    }

    None
}

pub fn find_cmake(app: &AppHandle) -> Option<(PathBuf, String)> {
    if let Some(bundled) = find_bundled_cmake(app) {
        let output = silent_command(&bundled)
            .arg("--version")
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let version = stdout.lines().next()?.split_whitespace().last()?.to_string();
        return Some((bundled, version));
    }

    let cmake = if cfg!(windows) { "cmake.exe" } else { "cmake" };
    let output = silent_command(cmake)
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

pub fn find_python() -> Option<(PathBuf, String)> {
    for bin in &["python3", "python"] {
        let output = silent_command(bin)
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

pub fn find_emsdk_python(emsdk_path: &Path) -> Option<(PathBuf, String)> {
    let python_dir = emsdk_path.join("python");
    if !python_dir.exists() {
        return None;
    }
    let entries = std::fs::read_dir(&python_dir).ok()?;
    for entry in entries.flatten() {
        let python_bin = if cfg!(windows) {
            entry.path().join("python.exe")
        } else {
            entry.path().join("bin").join("python3")
        };
        if python_bin.exists() {
            let output = silent_command(&python_bin)
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

pub fn which_sync(bin: &str) -> Option<PathBuf> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = silent_command(cmd)
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

pub fn silent_command(program: &(impl AsRef<std::ffi::OsStr> + ?Sized)) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub fn strip_unc_prefix(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") {
        PathBuf::from(&s[4..])
    } else {
        p
    }
}

pub fn auto_detect_emsdk(app: &AppHandle) -> Option<PathBuf> {
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

    if let Ok(emsdk_env) = std::env::var("EMSDK") {
        let path = PathBuf::from(&emsdk_env);
        if validate_emsdk(&path) {
            return Some(path);
        }
    }

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

pub fn version_ge(actual: &str, required: &str) -> bool {
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
// Tauri commands
// =============================================================================

#[tauri::command]
pub async fn get_toolchain_status(app: AppHandle) -> ToolchainStatus {
    tokio::task::spawn_blocking(move || get_toolchain_status_sync(&app))
        .await
        .unwrap_or_else(|_| ToolchainStatus {
            installed: false,
            emsdk_path: None,
            emscripten_version: None,
            emscripten_ok: false,
            cmake_found: false,
            cmake_version: None,
            cmake_ok: false,
            python_found: false,
            python_version: None,
            python_ok: false,
            corrupted: false,
            missing_tools: Vec::new(),
        })
}

fn get_toolchain_status_sync(app: &AppHandle) -> ToolchainStatus {
    let mut config = load_config(app);

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
            let detected = auto_detect_emsdk(app)?;
            let version = get_emcc_version(&detected);
            let path_str = detected.to_string_lossy().to_string();

            config.emsdk_path = Some(path_str.clone());
            let _ = save_config(app, &config);

            Some((Some(path_str), version))
        })
        .unwrap_or((None, None));

    let (cmake_found, cmake_version) = find_cmake(app)
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

    let missing_tools = emsdk_path
        .as_ref()
        .map(|p| validate_emsdk_integrity(&PathBuf::from(p)))
        .unwrap_or_default();
    let corrupted = !missing_tools.is_empty();

    ToolchainStatus {
        installed: emscripten_ok && cmake_ok && python_ok && !corrupted,
        emsdk_path,
        emscripten_version,
        emscripten_ok,
        cmake_found,
        cmake_version,
        cmake_ok,
        python_found,
        python_version,
        python_ok,
        corrupted,
        missing_tools,
    }
}

#[tauri::command]
pub async fn set_emsdk_path(app: AppHandle, path: String) -> Result<ToolchainStatus, String> {
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

    Ok(get_toolchain_status(app).await)
}

#[tauri::command]
pub async fn install_emsdk(app: AppHandle) -> Result<ToolchainStatus, String> {
    let install_dir = default_emsdk_install_path(&app);
    let install_dir_str = install_dir.to_string_lossy().to_string();
    let url = toolchain_archive_url();
    let is_zip = url.ends_with(".zip");

    emit_progress(&app, "download", "Downloading toolchain...", 0.05);

    let archive_data = download_with_progress(&app, &url).await?;

    if install_dir.exists() {
        std::fs::remove_dir_all(&install_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;

    emit_progress(&app, "extract", "Extracting toolchain...", 0.7);

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

    emit_progress(&app, "configure", "Configuring emscripten...", 0.9);
    generate_emscripten_config(&install_dir)?;

    emit_progress(&app, "complete", "Toolchain installed!", 1.0);

    let mut config = load_config(&app);
    config.emsdk_path = Some(install_dir_str);
    save_config(&app, &config)?;

    Ok(get_toolchain_status(app).await)
}

fn ninja_download_url() -> String {
    let platform = if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            "ninja-winarm64"
        } else {
            "ninja-win"
        }
    } else if cfg!(target_os = "macos") {
        "ninja-mac"
    } else if cfg!(target_arch = "aarch64") {
        "ninja-linux-aarch64"
    } else {
        "ninja-linux"
    };
    format!(
        "https://github.com/ninja-build/ninja/releases/download/v{}/{}.zip",
        NINJA_VERSION, platform
    )
}

#[tauri::command]
pub async fn repair_toolchain(app: AppHandle) -> Result<ToolchainStatus, String> {
    let config = load_config(&app);
    let emsdk_path = config
        .emsdk_path
        .ok_or("emsdk path not configured")?;
    let emsdk_dir = PathBuf::from(&emsdk_path);

    let missing = validate_emsdk_integrity(&emsdk_dir);
    if missing.is_empty() {
        return Ok(get_toolchain_status(app).await);
    }

    if missing.contains(&"ninja".to_string()) {
        let bin_dir = emsdk_dir.join("upstream").join("bin");
        let ninja_name = if cfg!(windows) { "ninja.exe" } else { "ninja" };

        emit_progress(&app, "download", "Downloading ninja...", 0.1);

        let url = ninja_download_url();
        let data = download_bytes(&url).await?;

        emit_progress(&app, "extract", "Installing ninja...", 0.7);

        let target = bin_dir.clone();
        let ninja = ninja_name.to_string();
        tokio::task::spawn_blocking(move || {
            let cursor = std::io::Cursor::new(&data);
            let mut archive =
                zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid zip: {}", e))?;
            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                let name = file.name().to_string();
                if name.ends_with(&ninja) {
                    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                    let out_path = target.join(&ninja);
                    let mut out =
                        std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;

                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        std::fs::set_permissions(
                            &out_path,
                            std::fs::Permissions::from_mode(0o755),
                        )
                        .ok();
                    }
                    return Ok(());
                }
            }
            Err("ninja not found in archive".to_string())
        })
        .await
        .map_err(|e| format!("Extract task failed: {}", e))??;
    }

    emit_progress(&app, "complete", "Toolchain repaired!", 1.0);
    Ok(get_toolchain_status(app).await)
}

// =============================================================================
// Download / extract helpers
// =============================================================================

pub async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }
    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Download failed: {}", e))
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

pub fn generate_emscripten_config(emsdk_dir: &Path) -> Result<(), String> {
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

pub fn extract_zip(data: &[u8], target: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid zip: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

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

pub fn extract_tar_gz(data: &[u8], target: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(data);
    let gz = flate2::read::GzDecoder::new(cursor);
    let mut archive = tar::Archive::new(gz);

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
    match path.find('/') {
        Some(idx) => &path[idx + 1..],
        None => "",
    }
}

pub fn emit_progress(app: &AppHandle, stage: &str, message: &str, progress: f32) {
    let _ = app.emit(
        "compile-progress",
        CompileProgress {
            stage: stage.to_string(),
            message: message.to_string(),
            progress,
        },
    );
}
