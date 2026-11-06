//! Lado Rust do AMV Studio: o mínimo possível.
//! Janela, plugins (diálogo, arquivos, sidecars) e o asset protocol.
//! Toda a lógica do editor fica em TypeScript (packages/*), testável sem Rust.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o AMV Studio");
}
