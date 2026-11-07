//! Lado Rust do AMV Studio: o mínimo possível.
//! Janela, plugins (diálogo, arquivos, sidecars, atualizador) e o asset protocol.
//! Toda a lógica do editor fica em TypeScript (packages/*), testável sem Rust.

const VAULT_SERVICE: &str = "AMV Studio";

/// Chaves de API ficam no cofre do sistema (Gerenciador de Credenciais no Windows).
/// Nunca em arquivo, log ou projeto.
#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(VAULT_SERVICE, &name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(VAULT_SERVICE, &name).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    let entry = keyring::Entry::new(VAULT_SERVICE, &name).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o AMV Studio");
}
