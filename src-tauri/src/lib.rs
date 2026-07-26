// APNs device token: push.m (native) пишет hex-токен в ~/Documents/sschat/apns_token.
// JS читает его через invoke('read_apns_token') и POSTит на /devices (fetch в api.js).
#[tauri::command]
fn read_apns_token() -> Option<String> {
  let home = std::env::var("HOME").ok()?;
  let path = std::path::Path::new(&home).join("Documents/sschat/apns_token");
  let token = std::fs::read_to_string(path).ok()?;
  let token = token.trim();
  if token.is_empty() { None } else { Some(token.to_string()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![read_apns_token])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
