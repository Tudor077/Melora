use std::process::{Command, Stdio};
use std::time::Duration;

/// Variables an AppImage's AppRun points at the bundled libraries.
///
/// They are correct for Melora itself and wrong for everything it spawns: a
/// browser started with these inherited loads Melora's copies of glib/gtk
/// instead of the system's and usually dies before drawing a window — which
/// looks exactly like "clicking Connect with Spotify does nothing".
const BUNDLE_ENV: &[&str] = &[
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "QT_PLUGIN_PATH",
    "PYTHONHOME",
    "PYTHONPATH",
    "PERLLIB",
    "ARGV0",
];

/// Hand the child the environment the user's session would have given it.
/// AppRun saves what it overwrote as `${VAR}_ORIG`, so prefer that; otherwise
/// drop the variable entirely rather than leak the bundle's value.
fn restore_session_env(cmd: &mut Command) {
    for var in BUNDLE_ENV {
        match std::env::var(format!("{var}_ORIG")) {
            Ok(original) => cmd.env(var, original),
            Err(_) => cmd.env_remove(var),
        };
    }
    // Only touched when AppRun actually saved one: emptying it would cost the
    // browser its icon themes and desktop integration.
    if let Ok(original) = std::env::var("XDG_DATA_DIRS_ORIG") {
        cmd.env("XDG_DATA_DIRS", original);
    }
}

/// True when `program` launched and did not fail outright. A missing binary
/// fails at spawn, which is what lets the caller try the next candidate.
fn launch(program: &str, prefix_args: &[&str], url: &str) -> bool {
    let mut cmd = Command::new(program);
    cmd.args(prefix_args)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    restore_session_env(&mut cmd);

    let Ok(mut child) = cmd.spawn() else {
        return false;
    };

    // xdg-open hands the URL over and exits; anything still alive after a
    // moment is the browser itself, which means the request was taken.
    for _ in 0..20 {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return false,
        }
    }
    true
}

/// Open an external URL in the user's real browser.
///
/// The opener plugin is enough everywhere except inside a Linux AppImage,
/// where the bundle's environment leaks into whatever it spawns. The frontend
/// calls this first and falls back to the plugin when it returns an error, so
/// Windows and macOS keep their existing path untouched.
#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    if !cfg!(target_os = "linux") {
        return Err("handled by the opener plugin on this platform".into());
    }
    // A browser is the only thing this should ever start.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("refusing to open a non-http(s) url".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut candidates: Vec<(String, Vec<&str>)> = Vec::new();
        // An explicit $BROWSER outranks the desktop's own handler.
        if let Ok(browser) = std::env::var("BROWSER") {
            if !browser.is_empty() {
                candidates.push((browser, Vec::new()));
            }
        }
        for (program, args) in [
            ("xdg-open", vec![]),
            ("gio", vec!["open"]),
            ("x-www-browser", vec![]),
            ("sensible-browser", vec![]),
            ("firefox", vec![]),
            ("chromium", vec![]),
            ("google-chrome-stable", vec![]),
        ] {
            candidates.push((program.to_string(), args));
        }

        for (program, args) in candidates {
            if launch(&program, &args, &url) {
                return Ok(());
            }
        }
        Err("could not launch a browser".to_string())
    })
    .await
    .map_err(|err| format!("opener task failed: {err}"))?
}

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
        .invoke_handler(tauri::generate_handler![open_external])
        .setup(|app| {
            // Portable builds ship without an installer, so nothing registers
            // the melora:// protocol for us — without this the Spotify OAuth
            // redirect dies in "no app can open this link". Registration is
            // per-user (HKCU on Windows, a .desktop entry on Linux) and points
            // at the current binary, so a moved exe/AppImage still works.
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
