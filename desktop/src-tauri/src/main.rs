//! ESEngine Editor - Desktop Application Entry Point

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    esengine_editor_lib::run();
}
