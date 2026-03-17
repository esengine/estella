//! MCP Bridge Server — HTTP API for AI tool integration
//!
//! Receives HTTP requests from the MCP Server process,
//! forwards them to the editor frontend via Tauri events,
//! and returns the response.

use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener};
use tiny_http::{Header, Response, Server};

const DEFAULT_PORT: u16 = 9920;
const MAX_PORT_ATTEMPTS: u16 = 10;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SCREENSHOT_TIMEOUT: Duration = Duration::from_secs(15);

pub struct BridgeServer {
    server: Option<Arc<Server>>,
    worker_handle: Option<thread::JoinHandle<()>>,
    shutdown: Arc<AtomicBool>,
    port: u16,
    bridge_file: Option<PathBuf>,
}

impl BridgeServer {
    pub fn new() -> Self {
        Self {
            server: None,
            worker_handle: None,
            shutdown: Arc::new(AtomicBool::new(false)),
            port: 0,
            bridge_file: None,
        }
    }

    pub fn start(&mut self, app_handle: AppHandle, project_path: Option<String>) -> Result<u16, String> {
        if self.server.is_some() {
            return Ok(self.port);
        }

        cleanup_stale_bridge_files();

        let server = try_bind(DEFAULT_PORT)?;
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(DEFAULT_PORT);
        self.port = port;

        let server = Arc::new(server);
        self.server = Some(server.clone());
        self.shutdown.store(false, Ordering::SeqCst);

        let shutdown = self.shutdown.clone();
        let app = app_handle.clone();
        let project = project_path.clone().unwrap_or_default();

        self.worker_handle = Some(thread::spawn(move || {
            worker_loop(server, shutdown, app, project);
        }));

        let bridge_path = project_path.as_deref().unwrap_or("__launcher__");
        let file = write_bridge_file(port, bridge_path);
        eprintln!("[BridgeServer] Bridge file written: {:?}", file);
        self.bridge_file = Some(file);

        Ok(port)
    }

    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(ref server) = self.server {
            server.unblock();
        }
        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }
        self.server = None;
        if let Some(ref path) = self.bridge_file.take() {
            let _ = std::fs::remove_file(path);
        }
    }

    pub fn update_project_path(&mut self, project_path: &str) {
        if let Some(ref old) = self.bridge_file {
            let _ = std::fs::remove_file(old);
        }
        if self.port > 0 {
            self.bridge_file = Some(write_bridge_file(self.port, project_path));
        }
    }
}

impl Drop for BridgeServer {
    fn drop(&mut self) {
        self.stop();
    }
}

// =============================================================================
// Worker
// =============================================================================

fn worker_loop(server: Arc<Server>, shutdown: Arc<AtomicBool>, app: AppHandle, project: String) {
    while !shutdown.load(Ordering::SeqCst) {
        let mut request = match server.recv_timeout(Duration::from_millis(500)) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(_) => break,
        };

        let method = request.method().to_string();
        let url = request.url().to_string();

        if method == "GET" && url == "/health" {
            let body = json!({
                "status": "ok",
                "version": env!("CARGO_PKG_VERSION"),
                "project": project,
            });
            let _ = respond_json(request, 200, &body);
            continue;
        }

        if method == "OPTIONS" {
            let _ = respond_cors_preflight(request);
            continue;
        }

        let (bridge_method, params) = match parse_request(&method, &url, request.as_reader()) {
            Ok(v) => v,
            Err(msg) => {
                let _ = respond_json(request, 400, &json!({ "error": msg }));
                continue;
            }
        };

        let timeout = if bridge_method == "capture" {
            SCREENSHOT_TIMEOUT
        } else {
            REQUEST_TIMEOUT
        };

        match forward_to_frontend(&app, &bridge_method, params, timeout) {
            Ok(result) => {
                let _ = respond_json(request, 200, &result);
            }
            Err(msg) => {
                let status = if msg.contains("timeout") { 504 } else { 500 };
                let _ = respond_json(request, status, &json!({ "error": msg }));
            }
        }
    }
}

// =============================================================================
// Request Parsing
// =============================================================================

fn parse_request(
    method: &str,
    url: &str,
    reader: &mut dyn std::io::Read,
) -> Result<(String, Value), String> {
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p, q),
        None => (url, ""),
    };

    let query_params = parse_query(query);

    match (method, path) {
        ("GET", "/scene/tree") => {
            let depth = query_params.get("depth").and_then(|v| v.parse::<u32>().ok());
            Ok(("getSceneTree".into(), json!({ "depth": depth })))
        }
        ("GET", "/scene/entity") => {
            let id = query_params.get("id").and_then(|v| v.parse::<i64>().ok());
            let name = query_params.get("name").cloned();
            Ok(("getEntityData".into(), json!({ "id": id, "name": name })))
        }
        ("GET", "/scene/selection") => {
            Ok(("getSelection".into(), json!({})))
        }
        ("GET", "/scene/find") => {
            let q = query_params.get("query").cloned().unwrap_or_default();
            Ok(("findEntities".into(), json!({ "query": q })))
        }
        ("GET", "/capture") => {
            let panel = query_params.get("panel").cloned();
            let max_width = query_params.get("maxWidth").and_then(|v| v.parse::<u32>().ok());
            Ok(("capture".into(), json!({ "panel": panel, "maxWidth": max_width })))
        }
        ("GET", "/state/logs") => {
            let count = query_params.get("count").and_then(|v| v.parse::<u32>().ok());
            let level = query_params.get("level").cloned();
            Ok(("getConsoleLogs".into(), json!({ "count": count, "level": level })))
        }
        ("GET", "/state/layout") => {
            Ok(("getPanelLayout".into(), json!({})))
        }
        ("GET", "/state/settings") => {
            let keys = query_params.get("keys").map(|k| {
                k.split(',').map(|s| s.trim().to_string()).collect::<Vec<_>>()
            });
            Ok(("getProjectSettings".into(), json!({ "keys": keys })))
        }
        ("GET", "/state/build") => {
            Ok(("getBuildStatus".into(), json!({})))
        }
        ("GET", "/state/build-configs") => {
            Ok(("listBuildConfigs".into(), json!({})))
        }
        ("GET", "/state/render-stats") => {
            Ok(("getRenderStats".into(), json!({})))
        }
        ("GET", "/state/element-bounds") => {
            let selector = query_params.get("selector").cloned().unwrap_or_default();
            Ok(("getElementBounds".into(), json!({ "selector": selector })))
        }
        ("POST", "/scene/create-entity") => {
            let body = read_json_body(reader)?;
            Ok(("createEntity".into(), body))
        }
        ("POST", "/scene/delete-entity") => {
            let body = read_json_body(reader)?;
            Ok(("deleteEntity".into(), body))
        }
        ("POST", "/scene/rename-entity") => {
            let body = read_json_body(reader)?;
            Ok(("renameEntity".into(), body))
        }
        ("POST", "/scene/reparent-entity") => {
            let body = read_json_body(reader)?;
            Ok(("reparentEntity".into(), body))
        }
        ("POST", "/scene/add-component") => {
            let body = read_json_body(reader)?;
            Ok(("addComponent".into(), body))
        }
        ("POST", "/scene/remove-component") => {
            let body = read_json_body(reader)?;
            Ok(("removeComponent".into(), body))
        }
        ("POST", "/scene/duplicate-entity") => {
            let body = read_json_body(reader)?;
            Ok(("duplicateEntity".into(), body))
        }
        ("POST", "/scene/instantiate-prefab") => {
            let body = read_json_body(reader)?;
            Ok(("instantiatePrefab".into(), body))
        }
        ("GET", "/assets/list") => {
            let asset_type = query_params.get("type").cloned();
            let mut p = json!({});
            if let Some(t) = asset_type { p["type"] = json!(t); }
            Ok(("listAssets".into(), p))
        }
        ("GET", "/assets/info") => {
            let uuid = query_params.get("uuid").cloned();
            let path = query_params.get("path").cloned();
            let mut p = json!({});
            if let Some(u) = uuid { p["uuid"] = json!(u); }
            if let Some(pa) = path { p["path"] = json!(pa); }
            Ok(("getAssetInfo".into(), p))
        }
        ("GET", "/components/list") => {
            Ok(("listComponents".into(), json!({})))
        }
        ("GET", "/components/schema") => {
            let name = query_params.get("name").cloned().unwrap_or_default();
            Ok(("getComponentSchema".into(), json!({ "name": name })))
        }
        ("GET", "/menus/list") => {
            Ok(("listMenus".into(), json!({})))
        }
        ("GET", "/scene/metadata") => {
            Ok(("getSceneMetadata".into(), json!({})))
        }
        ("POST", "/scene/toggle-visibility") => {
            let body = read_json_body(reader)?;
            Ok(("toggleVisibility".into(), body))
        }
        ("POST", "/scene/new") => {
            let body = read_json_body(reader)?;
            Ok(("newScene".into(), body))
        }
        ("POST", "/scene/open") => {
            let body = read_json_body(reader)?;
            Ok(("openScene".into(), body))
        }
        ("POST", "/scripts/create") => {
            let body = read_json_body(reader)?;
            Ok(("createScript".into(), body))
        }
        ("POST", "/action/select") => {
            let body = read_json_body(reader)?;
            Ok(("selectEntity".into(), body))
        }
        ("POST", "/action/set-property") => {
            let body = read_json_body(reader)?;
            Ok(("setProperty".into(), body))
        }
        ("POST", "/action/menu") => {
            let body = read_json_body(reader)?;
            Ok(("executeMenu".into(), body))
        }
        ("POST", "/action/play-mode") => {
            Ok(("togglePlayMode".into(), json!({})))
        }
        ("POST", "/action/save-scene") => {
            Ok(("saveScene".into(), json!({})))
        }
        ("POST", "/action/reload-scripts") => {
            Ok(("reloadScripts".into(), json!({})))
        }
        ("POST", "/action/undo") => {
            Ok(("undo".into(), json!({})))
        }
        ("POST", "/action/redo") => {
            Ok(("redo".into(), json!({})))
        }
        ("POST", "/action/build") => {
            let body = read_json_body(reader)?;
            Ok(("buildProject".into(), body))
        }
        ("GET", "/timeline/data") => {
            let uuid = query_params.get("uuid").cloned();
            let path = query_params.get("path").cloned();
            let mut p = json!({});
            if let Some(u) = uuid { p["uuid"] = json!(u); }
            if let Some(pa) = path { p["path"] = json!(pa); }
            Ok(("getTimelineData".into(), p))
        }
        ("POST", "/timeline/update") => {
            let body = read_json_body(reader)?;
            Ok(("updateTimelineData".into(), body))
        }
        ("GET", "/assets/meta") => {
            let uuid = query_params.get("uuid").cloned();
            let path = query_params.get("path").cloned();
            let mut p = json!({});
            if let Some(u) = uuid { p["uuid"] = json!(u); }
            if let Some(pa) = path { p["path"] = json!(pa); }
            Ok(("getAssetMeta".into(), p))
        }
        ("POST", "/assets/meta/update") => {
            let body = read_json_body(reader)?;
            Ok(("updateAssetMeta".into(), body))
        }
        ("POST", "/assets/meta/ensure") => {
            let body = read_json_body(reader)?;
            Ok(("ensureAssetMeta".into(), body))
        }
        ("POST", "/assets/create") => {
            let body = read_json_body(reader)?;
            Ok(("createAsset".into(), body))
        }
        ("POST", "/assets/delete") => {
            let body = read_json_body(reader)?;
            Ok(("deleteAsset".into(), body))
        }
        ("POST", "/assets/rename") => {
            let body = read_json_body(reader)?;
            Ok(("renameAsset".into(), body))
        }
        ("POST", "/ui/create") => {
            let body = read_json_body(reader)?;
            Ok(("instantiateTemplate".into(), body))
        }
        // Launcher / project management routes
        ("GET", "/editor/status") => {
            Ok(("getEditorStatus".into(), json!({})))
        }
        ("GET", "/projects/recent") => {
            Ok(("listRecentProjects".into(), json!({})))
        }
        ("GET", "/projects/examples") => {
            Ok(("listExamples".into(), json!({})))
        }
        ("POST", "/projects/open") => {
            let body = read_json_body(reader)?;
            Ok(("openProject".into(), body))
        }
        ("POST", "/projects/create-from-example") => {
            let body = read_json_body(reader)?;
            Ok(("createFromExample".into(), body))
        }
        _ => Err(format!("Unknown route: {} {}", method, path)),
    }
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    if query.is_empty() {
        return map;
    }
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            map.insert(
                urlencoding::decode(k).unwrap_or_default().into_owned(),
                urlencoding::decode(v).unwrap_or_default().into_owned(),
            );
        }
    }
    map
}

fn read_json_body(reader: &mut dyn std::io::Read) -> Result<Value, String> {
    let mut buf = String::new();
    reader.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    if buf.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&buf).map_err(|e| format!("Invalid JSON body: {}", e))
}

// =============================================================================
// Tauri Event Bridge
// =============================================================================

fn forward_to_frontend(
    app: &AppHandle,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let id = generate_request_id();
    let event_name = format!("mcp-response-{}", id);

    let (tx, rx) = std::sync::mpsc::channel::<String>();

    let _unlisten = app.once(&event_name, move |event| {
        let _ = tx.send(event.payload().to_string());
    });

    app.emit(
        "mcp-request",
        json!({ "id": id, "method": method, "params": params }),
    )
    .map_err(|e| e.to_string())?;

    let raw = rx
        .recv_timeout(timeout)
        .map_err(|_| format!("Frontend response timeout ({}s)", timeout.as_secs()))?;

    serde_json::from_str::<Value>(&raw)
        .map_err(|e| format!("Invalid response JSON: {}", e))
}

fn generate_request_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let thread_id = format!("{:?}", thread::current().id());
    format!("{:x}-{:x}", nanos, {
        let mut h = DefaultHasher::new();
        thread_id.hash(&mut h);
        h.finish()
    })
}

// =============================================================================
// HTTP Helpers
// =============================================================================

fn respond_json(
    request: tiny_http::Request,
    status: u16,
    body: &Value,
) -> Result<(), std::io::Error> {
    let data = serde_json::to_vec(body).unwrap_or_default();
    let response = Response::from_data(data)
        .with_status_code(status)
        .with_header(
            Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
        )
        .with_header(
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        );
    request.respond(response)
}

fn respond_cors_preflight(request: tiny_http::Request) -> Result<(), std::io::Error> {
    let response = Response::from_string("")
        .with_status_code(204)
        .with_header(
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        )
        .with_header(
            Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..])
                .unwrap(),
        )
        .with_header(
            Header::from_bytes(
                &b"Access-Control-Allow-Headers"[..],
                &b"Content-Type"[..],
            )
            .unwrap(),
        );
    request.respond(response)
}

// =============================================================================
// Port Binding
// =============================================================================

fn try_bind(base_port: u16) -> Result<Server, String> {
    for offset in 0..MAX_PORT_ATTEMPTS {
        let port = base_port + offset;
        match Server::http(format!("127.0.0.1:{}", port)) {
            Ok(server) => return Ok(server),
            Err(_) if offset < MAX_PORT_ATTEMPTS - 1 => continue,
            Err(e) => return Err(format!("Failed to bind port {}-{}: {}", base_port, base_port + MAX_PORT_ATTEMPTS - 1, e)),
        }
    }
    Err("Failed to bind any port".to_string())
}

// =============================================================================
// Bridge File
// =============================================================================

fn bridge_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());

    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());

    PathBuf::from(home).join(".esengine")
}

fn bridge_file_path(project_path: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    project_path.hash(&mut hasher);
    let hash = hasher.finish();
    bridge_dir().join(format!("bridge-{:x}.json", hash))
}

fn write_bridge_file(port: u16, project_path: &str) -> PathBuf {
    let dir = bridge_dir();
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[BridgeServer] Failed to create bridge dir {:?}: {}", dir, e);
    }
    let path = bridge_file_path(project_path);
    let content = json!({
        "port": port,
        "pid": std::process::id(),
        "projectPath": project_path,
    });
    match std::fs::File::create(&path) {
        Ok(mut f) => {
            if let Err(e) = f.write_all(serde_json::to_string_pretty(&content).unwrap_or_default().as_bytes()) {
                eprintln!("[BridgeServer] Failed to write bridge file {:?}: {}", path, e);
            }
        }
        Err(e) => {
            eprintln!("[BridgeServer] Failed to create bridge file {:?}: {}", path, e);
        }
    }
    path
}

fn cleanup_stale_bridge_files() {
    let dir = bridge_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let my_pid = std::process::id();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("bridge-") || !name.ends_with(".json") {
            continue;
        }
        let path = entry.path();
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(info) = serde_json::from_str::<Value>(&content) {
                if let Some(pid) = info.get("pid").and_then(|v| v.as_u64()) {
                    let pid = pid as u32;
                    if pid != my_pid && !is_process_alive(pid) {
                        eprintln!("[BridgeServer] Cleaning stale bridge file: {:?} (pid {})", path, pid);
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn is_process_alive(pid: u32) -> bool {
    use std::ptr::null_mut;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        fn GetExitCodeProcess(handle: *mut std::ffi::c_void, code: *mut u32) -> i32;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() || handle == null_mut() {
            return false;
        }
        let mut exit_code: u32 = 0;
        let ok = GetExitCodeProcess(handle, &mut exit_code);
        CloseHandle(handle);
        ok != 0 && exit_code == STILL_ACTIVE
    }
}

#[cfg(not(target_os = "windows"))]
fn is_process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
