// Copyright GraphCaster. All Rights Reserved.

use serde::Serialize;
use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{App, AppHandle, Emitter, Wry};

#[derive(Serialize, Clone)]
struct MenuEventPayload<'a> {
    id: &'a str,
}

pub fn build_app_menu(app: &mut App<Wry>) -> tauri::Result<Menu<Wry>> {
    let handle = app.handle();

    let file = SubmenuBuilder::new(handle, "File")
        .item(
            &MenuItemBuilder::with_id("file.new", "New workflow")
                .accelerator("CmdOrCtrl+N")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.open", "Open workflow…")
                .accelerator("CmdOrCtrl+O")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.export", "Export…")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(handle)?,
        )
        .item(&MenuItemBuilder::with_id("file.import", "Import…").build(handle)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("file.quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(handle)?,
        )
        .build()?;

    let edit = SubmenuBuilder::new(handle, "Edit")
        .item(
            &MenuItemBuilder::with_id("edit.undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.redo", "Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(handle)?,
        )
        .separator()
        .item(&PredefinedMenuItem::cut(handle, Some("Cut"))?)
        .item(&PredefinedMenuItem::copy(handle, Some("Copy"))?)
        .item(&PredefinedMenuItem::paste(handle, Some("Paste"))?)
        .item(
            &MenuItemBuilder::with_id("edit.duplicate", "Duplicate")
                .accelerator("CmdOrCtrl+D")
                .build(handle)?,
        )
        .item(&PredefinedMenuItem::select_all(handle, Some("Select all"))?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.find", "Find")
                .accelerator("CmdOrCtrl+F")
                .build(handle)?,
        )
        .build()?;

    let view = SubmenuBuilder::new(handle, "View")
        .item(&MenuItemBuilder::with_id("view.toggleTheme", "Toggle theme").build(handle)?)
        .item(&MenuItemBuilder::with_id("view.toggleMinimap", "Toggle minimap").build(handle)?)
        .item(
            &MenuItemBuilder::with_id("view.toggleSidebar", "Toggle sidebar")
                .accelerator("CmdOrCtrl+B")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.zoomIn", "Zoom in")
                .accelerator("CmdOrCtrl+=")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.zoomOut", "Zoom out")
                .accelerator("CmdOrCtrl+-")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.fitView", "Fit view")
                .accelerator("CmdOrCtrl+0")
                .build(handle)?,
        )
        .build()?;

    let run = SubmenuBuilder::new(handle, "Run")
        .item(
            &MenuItemBuilder::with_id("run.execute", "Execute workflow")
                .accelerator("F5")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("run.stop", "Stop execution")
                .accelerator("Escape")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("run.openExecutions", "Open executions")
                .accelerator("CmdOrCtrl+E")
                .build(handle)?,
        )
        .build()?;

    let help = SubmenuBuilder::new(handle, "Help")
        .item(&MenuItemBuilder::with_id("help.shortcuts", "Keyboard shortcuts").build(handle)?)
        .item(&MenuItemBuilder::with_id("help.about", "About").build(handle)?)
        .item(&MenuItemBuilder::with_id("help.documentation", "Documentation").build(handle)?)
        .item(&MenuItemBuilder::with_id("help.reportIssue", "Report issue").build(handle)?)
        .build()?;

    let menu = MenuBuilder::new(handle)
        .items(&[&file, &edit, &view, &run, &help])
        .build()?;

    Ok(menu)
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == "file.quit" {
        app.exit(0);
        return;
    }
    let _ = app.emit("menu", MenuEventPayload { id });
}
