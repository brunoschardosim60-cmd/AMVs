//! Lado Rust do AMV Studio: o mínimo possível.
//! Janela, plugins (diálogo, arquivos, sidecars, atualizador) e o asset protocol.
//! Toda a lógica do editor fica em TypeScript (packages/*), testável sem Rust.

use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::State;

const VAULT_SERVICE: &str = "AMV Studio";

struct AnalyzerProcess {
    child: Child,
    port: u16,
    token: String,
}

impl Drop for AnalyzerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct AnalyzerState(Mutex<Option<AnalyzerProcess>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzerConnection {
    base_url: String,
    token: String,
}

fn spawn_analyzer(program: &str, args: &[&str]) -> Result<(Child, String), String> {
    let mut child = Command::new(program)
        .args(args)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("não foi possível iniciar {program}: {e}"))?;

    let mut ready = String::new();
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        let _ = child.wait();
        "saída do analisador indisponível".to_owned()
    })?;
    let read_result = BufReader::new(stdout).read_line(&mut ready);
    if read_result.is_err() || ready.trim().is_empty() {
        let mut stderr = String::new();
        if let Some(mut output) = child.stderr.take() {
            use std::io::Read;
            let _ = output.read_to_string(&mut stderr);
        }
        let _ = child.kill();
        let _ = child.wait();
        let detail = stderr.trim();
        return Err(if detail.is_empty() {
            format!("o analisador encerrou antes de iniciar ({} -m amv_analyzer)", program)
        } else {
            format!("o analisador não iniciou: {detail}")
        });
    }
    Ok((child, ready))
}

fn start_analyzer_process() -> Result<AnalyzerProcess, String> {
    let attempts: [(&str, &[&str]); 3] = [
        ("python", &["-m", "amv_analyzer"]),
        ("py", &["-3", "-m", "amv_analyzer"]),
        ("python3", &["-m", "amv_analyzer"]),
    ];
    let mut errors = Vec::new();
    for (program, args) in attempts {
        match spawn_analyzer(program, args) {
            Ok((mut child, line)) => {
                let parsed = (|| {
                    let ready: serde_json::Value = serde_json::from_str(line.trim())
                        .map_err(|e| format!("resposta de inicialização inválida do analisador: {e}"))?;
                    let port = ready["port"]
                        .as_u64()
                        .and_then(|value| u16::try_from(value).ok())
                        .filter(|value| *value > 0)
                        .ok_or("porta do analisador inválida")?;
                    let token = ready["token"]
                        .as_str()
                        .filter(|value| !value.is_empty())
                        .ok_or("token do analisador ausente")?
                        .to_owned();
                    Ok::<(u16, String), String>((port, token))
                })();
                match parsed {
                    Ok((port, token)) => return Ok(AnalyzerProcess { child, port, token }),
                    Err(error) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        errors.push(error);
                    }
                }
            }
            Err(error) => errors.push(error),
        }
    }
    Err(format!(
        "{}. Para instalar, acesse services/analyzer e execute: python -m pip install -e \".[speech]\".",
        errors.join("; ")
    ))
}

#[tauri::command]
fn analyzer_start(state: State<'_, AnalyzerState>) -> Result<AnalyzerConnection, String> {
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = current.as_mut() {
        if existing.child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(AnalyzerConnection {
                base_url: format!("http://127.0.0.1:{}", existing.port),
                token: existing.token.clone(),
            });
        }
        *current = None;
    }
    let process = start_analyzer_process()?;
    let connection = AnalyzerConnection {
        base_url: format!("http://127.0.0.1:{}", process.port),
        token: process.token.clone(),
    };
    *current = Some(process);
    Ok(connection)
}

#[tauri::command]
fn analyzer_stop(state: State<'_, AnalyzerState>) -> Result<(), String> {
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    *current = None;
    Ok(())
}

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
        .manage(AnalyzerState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete, analyzer_start, analyzer_stop])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o AMV Studio");
}
