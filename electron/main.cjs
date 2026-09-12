const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
app.setName("Ember");
let backend,
  mainWindow,
  closing = false;
if (process.env.EMBER_DATA_DIR)
  app.setPath("userData", path.join(process.env.EMBER_DATA_DIR, "electron"));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on("second-instance", () => {
  mainWindow?.show();
  mainWindow?.focus();
});
app
  .whenReady()
  .then(async () => {
    const { createApp } = await import(
      pathToFileURL(path.join(__dirname, "../server/index.mjs")).href
    );
    backend = await createApp({
      dataDir:
        process.env.EMBER_DATA_DIR ||
        path.join(app.getPath("userData"), "workspace"),
      port: 0,
    });
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 900,
      minHeight: 650,
      title: "Ember",
      backgroundColor: "#191919",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (["https:", "http:"].includes(parsed.protocol))
          shell.openExternal(url);
      } catch {}
      return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== backend.url) event.preventDefault();
    });
    mainWindow.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    ipcMain.handle("choose-folder", async (event) => {
      if (
        event.senderFrame.url.split("/").slice(0, 3).join("/") !== backend.url
      )
        throw new Error("Untrusted frame");
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: "Choose a project folder",
      });
      return result.canceled ? null : result.filePaths[0];
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Ember",
          submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
        },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { role: "togglefullscreen" },
          ],
        },
      ]),
    );
    await mainWindow.loadURL(backend.url);
    mainWindow.on("close", (event) => {
      if (closing) return;
      const active =
        backend.store.data.tasks.some((t) =>
          ["running", "queued", "approval"].includes(t.status),
        ) || backend.downloads.active;
      if (active) {
        event.preventDefault();
        dialog
          .showMessageBox(mainWindow, {
            type: "question",
            title: "Work is still running",
            message: "Quit Ember and stop active work?",
            detail:
              "Model downloads can be resumed next time. Active tasks will be marked as interrupted.",
            buttons: ["Keep working", "Quit Ember"],
            defaultId: 0,
            cancelId: 0,
          })
          .then((result) => {
            if (result.response === 1) {
              closing = true;
              app.quit();
            }
          });
      }
    });
  })
  .catch((error) => {
    dialog.showErrorBox("Ember could not start", error.stack || error.message);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (backend && !backend.quitting) {
    event.preventDefault();
    backend.quitting = true;
    backend.close().finally(() => {
      closing = true;
      app.quit();
    });
  }
});
