//! ESEngine Editor Library

mod preview_server;

use preview_server::PreviewServer;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

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
fn open_preview_in_browser(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}", port);
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
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
        .manage(AppState {
            preview_server: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_preview_server,
            stop_preview_server,
            open_preview_in_browser,
            open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
