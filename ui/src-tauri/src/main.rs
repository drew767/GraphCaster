// Copyright GraphCaster. All Rights Reserved.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod run_bridge;

use run_bridge::RunSessionState;

fn main() {
    tauri::Builder::default()
        .manage(RunSessionState::default())
        .invoke_handler(tauri::generate_handler![
            run_bridge::get_run_environment_info,
            run_bridge::gc_start_run,
            run_bridge::gc_cancel_run,
            run_bridge::gc_list_persisted_runs,
            run_bridge::gc_read_persisted_events,
            run_bridge::gc_read_persisted_run_summary,
        ])
        .build(tauri::generate_context!())
        .expect("error while building GraphCaster")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                run_bridge::kill_all_on_app_exit(app);
            }
        });
}
