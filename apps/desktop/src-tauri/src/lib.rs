#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // single-instance is desktop-only: it forwards the deep link from the
    // second process launched by the OS protocol handler. On Android the OS
    // delivers deep links straight to the running activity via onOpenUrl.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        use tauri::{Emitter, Manager};
        // Focus the existing window
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
        // Forward any deep link URL to the frontend
        for arg in &args {
            if arg.starts_with("melora://") {
                let _ = app.emit("deep-link-received", arg.clone());
                break;
            }
        }
    }));

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // The exe ships portable (no installer), so nothing ever writes the
            // melora:// protocol into the registry — without this, the Spotify
            // OAuth redirect dies in a "Get an app to open this link" dialog.
            // Runtime registration goes to HKCU and re-points the handler at
            // the current exe path on every launch, so a moved exe still works.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("deep-link registration failed: {err}");
                }
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
