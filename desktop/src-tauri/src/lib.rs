//! ESEngine Editor Library

mod compiler;
mod embedded_assets;
mod preview_server;

use preview_server::PreviewServer;
use std::io::Read as _;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// =============================================================================
// State
// =============================================================================

struct AppState {
    preview_server: Mutex<Option<PreviewServer>>,
}

// =============================================================================
// Commands
// =============================================================================

#[tauri::command]
fn toggle_devtools(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
}

#[tauri::command]
fn start_preview_server(
    state: State<AppState>,
    project_dir: String,
    port: u16,
) -> Result<u16, String> {
    let mut server_lock = state.preview_server.lock().unwrap();
    let new_dir = PathBuf::from(&project_dir);

    if let Some(ref server) = *server_lock {
        if server.is_running() {
            if server.project_dir() != new_dir {
                server.set_project_dir(new_dir);
            }
            return Ok(server.port());
        }
    }

    let mut server = PreviewServer::new(new_dir, port);
    let port = server.start()?;
    *server_lock = Some(server);
    Ok(port)
}

#[tauri::command]
fn stop_preview_server(state: State<AppState>) {
    let mut server_lock = state.preview_server.lock().unwrap();
    if let Some(ref mut server) = *server_lock {
        server.stop();
    }
    *server_lock = None;
}

#[tauri::command]
fn notify_preview_reload(state: State<AppState>) {
    let server_lock = state.preview_server.lock().unwrap();
    if let Some(ref server) = *server_lock {
        server.notify_reload();
    }
}

#[tauri::command]
fn open_preview_in_browser(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}", port);
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn unzip_to_directory(zip_bytes: Vec<u8>, target_dir: String) -> Result<(), String> {
    let target = PathBuf::from(&target_dir);
    if target.exists() {
        return Err("Target directory already exists".to_string());
    }
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;

    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        if name.starts_with("__MACOSX") || name.ends_with(".DS_Store") {
            continue;
        }

        let out_path = target.join(&name);

        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            std::fs::write(&out_path, &buf).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_embedded_asset(name: String) -> Result<Vec<u8>, String> {
    match name.as_str() {
        "engine.js" => Ok(embedded_assets::ENGINE_JS.to_vec()),
        "engine.wasm" => Ok(embedded_assets::ENGINE_WASM.to_vec()),
        "engine.single.js" => Ok(embedded_assets::ENGINE_SINGLE_JS.to_vec()),
        "engine.wxgame.js" => Ok(embedded_assets::ENGINE_WXGAME_JS.to_vec()),
        "engine.wxgame.wasm" => Ok(embedded_assets::ENGINE_WXGAME_WASM.to_vec()),
        "sdk.wechat.js" => Ok(embedded_assets::SDK_WECHAT_JS.to_vec()),
        "sdk.esm.js" => Ok(embedded_assets::SDK_ESM_JS.to_vec()),
        "sdk.esm.dts" => Ok(embedded_assets::SDK_ESM_DTS.to_vec()),
        "sdk.wasm.js" => Ok(embedded_assets::SDK_WASM_JS.to_vec()),
        "sdk.wasm.dts" => Ok(embedded_assets::SDK_WASM_DTS.to_vec()),
        "sdk.shared.wasm.dts" => Ok(embedded_assets::SDK_SHARED_WASM_DTS.to_vec()),
        "sdk.shared.app.dts" => Ok(embedded_assets::SDK_SHARED_APP_DTS.to_vec()),
        "sdk.physics.dts" => Ok(embedded_assets::SDK_PHYSICS_DTS.to_vec()),
        "sdk.spine.dts" => Ok(embedded_assets::SDK_SPINE_DTS.to_vec()),
        "editor.dts" => Ok(embedded_assets::EDITOR_DTS.to_vec()),
        "spine38.js" => Ok(embedded_assets::SPINE38_JS.to_vec()),
        "spine38.wasm" => Ok(embedded_assets::SPINE38_WASM.to_vec()),
        "spine41.js" => Ok(embedded_assets::SPINE41_JS.to_vec()),
        "spine41.wasm" => Ok(embedded_assets::SPINE41_WASM.to_vec()),
        "spine42.js" => Ok(embedded_assets::SPINE42_JS.to_vec()),
        "spine42.wasm" => Ok(embedded_assets::SPINE42_WASM.to_vec()),
        "physics.js" => Ok(embedded_assets::PHYSICS_JS.to_vec()),
        "physics.wasm" => Ok(embedded_assets::PHYSICS_WASM.to_vec()),
        "esbuild.wasm" => Ok(embedded_assets::ESBUILD_WASM.to_vec()),
        _ => Err(format!("Unknown embedded asset: {}", name)),
    }
}

#[derive(Clone, serde::Serialize)]
struct CommandOutput {
    stream: String,
    data: String,
}

#[derive(serde::Serialize)]
struct CommandResult {
    code: i32,
}

#[tauri::command]
async fn execute_command(
    app: AppHandle,
    cmd: String,
    args: Vec<String>,
    cwd: String,
) -> Result<CommandResult, String> {
    let mut child = Command::new(&cmd)
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let app_stdout = app.clone();
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stdout.emit("command-output", CommandOutput {
                stream: "stdout".to_string(),
                data: line,
            });
        }
    });

    let app_stderr = app.clone();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stderr.emit("command-output", CommandOutput {
                stream: "stderr".to_string(),
                data: line,
            });
        }
    });

    let _ = tokio::join!(stdout_handle, stderr_handle);

    let status = child.wait().await.map_err(|e| e.to_string())?;

    Ok(CommandResult {
        code: status.code().unwrap_or(-1),
    })
}

// =============================================================================
// Update (proxy-aware)
// =============================================================================

fn resolve_proxy(explicit: Option<String>) -> Option<url::Url> {
    explicit
        .filter(|s| !s.is_empty())
        .or_else(|| {
            ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
                .iter()
                .find_map(|key| std::env::var(key).ok())
        })
        .and_then(|s| url::Url::parse(&s).ok())
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    body: Option<String>,
}

#[tauri::command]
async fn check_update(app: AppHandle, proxy: Option<String>) -> Result<Option<UpdateInfo>, String> {
    let mut builder = app.updater_builder();
    if let Some(proxy_url) = resolve_proxy(proxy) {
        builder = builder.proxy(proxy_url);
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version.clone(),
            body: update.body.clone(),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_update(app: AppHandle, proxy: Option<String>) -> Result<(), String> {
    let mut builder = app.updater_builder();
    if let Some(proxy_url) = resolve_proxy(proxy) {
        builder = builder.proxy(proxy_url);
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())
}

// =============================================================================
// Entry Point
// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            preview_server: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            toggle_devtools,
            start_preview_server,
            stop_preview_server,
            notify_preview_reload,
            open_preview_in_browser,
            open_folder,
            unzip_to_directory,
            execute_command,
            get_embedded_asset,
            check_update,
            install_update,
            compiler::get_toolchain_status,
            compiler::set_emsdk_path,
            compiler::install_emsdk,
            compiler::compile_wasm,
            compiler::clear_build_cache,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut server_lock) = state.preview_server.lock() {
                        if let Some(ref mut server) = *server_lock {
                            server.stop();
                        }
                        *server_lock = None;
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
