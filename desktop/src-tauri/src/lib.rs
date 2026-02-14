//! ESEngine Editor Library

mod embedded_assets;
mod preview_server;

use preview_server::PreviewServer;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
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

    if let Some(ref server) = *server_lock {
        if server.is_running() {
            return Ok(server.port());
        }
    }

    let mut server = PreviewServer::new(PathBuf::from(project_dir), port);
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
fn open_folder(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_engine_js() -> Vec<u8> {
    embedded_assets::ENGINE_JS.to_vec()
}

#[tauri::command]
fn get_engine_wasm() -> Vec<u8> {
    embedded_assets::ENGINE_WASM.to_vec()
}

#[tauri::command]
fn get_engine_single_js() -> Vec<u8> {
    embedded_assets::ENGINE_SINGLE_JS.to_vec()
}

#[tauri::command]
fn get_engine_wxgame_js() -> Vec<u8> {
    embedded_assets::ENGINE_WXGAME_JS.to_vec()
}

#[tauri::command]
fn get_engine_wxgame_wasm() -> Vec<u8> {
    embedded_assets::ENGINE_WXGAME_WASM.to_vec()
}

#[tauri::command]
fn get_sdk_wechat_js() -> Vec<u8> {
    embedded_assets::SDK_WECHAT_JS.to_vec()
}

#[tauri::command]
fn get_sdk_esm_js() -> Vec<u8> {
    embedded_assets::SDK_ESM_JS.to_vec()
}

#[tauri::command]
fn get_sdk_esm_dts() -> Vec<u8> {
    embedded_assets::SDK_ESM_DTS.to_vec()
}

#[tauri::command]
fn get_sdk_wasm_js() -> Vec<u8> {
    embedded_assets::SDK_WASM_JS.to_vec()
}

#[tauri::command]
fn get_sdk_wasm_dts() -> Vec<u8> {
    embedded_assets::SDK_WASM_DTS.to_vec()
}

#[tauri::command]
fn get_editor_dts() -> Vec<u8> {
    embedded_assets::EDITOR_DTS.to_vec()
}

#[tauri::command]
fn get_spine38_js() -> Vec<u8> {
    embedded_assets::SPINE38_JS.to_vec()
}

#[tauri::command]
fn get_spine38_wasm() -> Vec<u8> {
    embedded_assets::SPINE38_WASM.to_vec()
}

#[tauri::command]
fn get_spine41_js() -> Vec<u8> {
    embedded_assets::SPINE41_JS.to_vec()
}

#[tauri::command]
fn get_spine41_wasm() -> Vec<u8> {
    embedded_assets::SPINE41_WASM.to_vec()
}

#[tauri::command]
fn get_spine42_js() -> Vec<u8> {
    embedded_assets::SPINE42_JS.to_vec()
}

#[tauri::command]
fn get_spine42_wasm() -> Vec<u8> {
    embedded_assets::SPINE42_WASM.to_vec()
}

#[tauri::command]
fn get_physics_js() -> Vec<u8> {
    embedded_assets::PHYSICS_JS.to_vec()
}

#[tauri::command]
fn get_physics_wasm() -> Vec<u8> {
    embedded_assets::PHYSICS_WASM.to_vec()
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
            execute_command,
            get_engine_js,
            get_engine_wasm,
            get_engine_single_js,
            get_engine_wxgame_js,
            get_engine_wxgame_wasm,
            get_sdk_wechat_js,
            get_sdk_esm_js,
            get_sdk_esm_dts,
            get_sdk_wasm_js,
            get_sdk_wasm_dts,
            get_editor_dts,
            get_spine38_js,
            get_spine38_wasm,
            get_spine41_js,
            get_spine41_wasm,
            get_spine42_js,
            get_spine42_wasm,
            get_physics_js,
            get_physics_wasm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
