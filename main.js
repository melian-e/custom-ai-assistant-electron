// main.js
// ChatGPT Electron
// by Andaroth
// https://github.com/Andaroth/ai-assistant-electron

const availableAIs = require("./settings.json").availableAIs;

const { Menu, app, BrowserWindow, session } = require("electron");
const prompt = require("electron-prompt");

const fs = require("fs");
const path = require("path");

let win;
let userSettings;

let width = 400;
let height = 600;

const isMac = process.platform === "darwin";

const defaultSettings = {
  theme: "default.css",
  streamer: false,
  assistant: "ChatGPT",
};

const userDataPath = app.getPath("userData");
const configPath = path.join(userDataPath, "config.json");
const sessionFile = path.join(userDataPath, "sessions.json");

function changeAssistant(label, url, save = false, killCookies = true) {
  // kill cookies on AI change to prevent cookie errors:
  if (killCookies)
    win.webContents.session.clearStorageData({ storages: ["cookies"] });
  win.loadURL(url);
  if (save) {
    let currentSettings = Object.assign(
      {},
      userSettings || loadUserPreferences()
    ); // mock
    const mutateConfig = Object.assign(currentSettings, { assistant: label }); // mutate
    userSettings = mutateConfig; // assign
    fs.writeFileSync(configPath, JSON.stringify(userSettings), "utf-8"); // save
  }
}

function loadUserPreferences() {
  if (fs.existsSync(configPath)) {
    const configFile = fs.readFileSync(configPath, "utf-8");
    userSettings = JSON.parse(configFile);
    return userSettings;
  } else {
    // create config file if it does not exist
    fs.writeFileSync(configPath, JSON.stringify(defaultSettings)); // create settings
    return loadUserPreferences();
  }
}

function changeUserTheme(name, reload = false) {
  let currentSettings = Object.assign(
    {},
    userSettings || loadUserPreferences()
  ); // mock
  const mutateConfig = Object.assign(currentSettings, { theme: name }); // mutate
  userSettings = mutateConfig; // assign
  const configFile = path.join(app.getPath("userData"), "config.json");
  fs.writeFileSync(configFile, JSON.stringify(userSettings), "utf-8"); // save
  const cssFile = path.join(userDataPath, name);
  if (fs.existsSync(cssFile)) {
    const cssContent = fs.readFileSync(cssFile, "utf8");
    win.webContents.insertCSS(cssContent);
  } else {
    fs.writeFileSync(cssFile, ""); // create empty theme
    win.reload();
  }
  if (reload) win.reload();
}

function toggleStreamer() {
  let currentSettings = Object.assign(
    {},
    userSettings || loadUserPreferences()
  ); // mock
  const mutateConfig = Object.assign(currentSettings, {
    streamer: !currentSettings.streamer,
  }); // mutate
  userSettings = mutateConfig; // assign
  const configFile = path.join(app.getPath("userData"), "config.json");
  fs.writeFileSync(configFile, JSON.stringify(userSettings), "utf-8"); // save
  win.reload();
}

function fetchThemes() {
  const cssFiles = fs
    .readdirSync(userDataPath)
    .filter((file) => path.extname(file) === ".css")
    .map((label) => label);
  return cssFiles || ["default.css"];
}
function getSessions() {
  if (fs.existsSync(sessionFile)) {
    const sessions = JSON.parse(fs.readFileSync(sessionFile));
    return sessions || {};
  } else {
    fs.writeFileSync(sessionFile, "{}", "utf-8");
    return getSessions();
  }
}

function getSessionsNames() {
  return Object.keys(getSessions() || {}) || [];
}

function removeSession(name, session) {
  const mutableSession = getSessions() || {};
  if (mutableSession[name]) {
    delete mutableSession[name];
    const sessionFile = path.join(app.getPath("userData"), "sessions.json");
    fs.writeFileSync(sessionFile, JSON.stringify(mutableSession));
    setTimeout(() => win.reload(), 1000);
  }
}

function storeSession(name, session) {
  // console.log('storeSession')
  if (Object.keys(session).length) {
    const mutableSession = getSessions() || {};
    session.cookies.get({}).then((cookies) => {
      // console.log('store, cookies', cookies);
      mutableSession[name] = { cookies };
      const sessionFile = path.join(app.getPath("userData"), "sessions.json");
      fs.writeFileSync(sessionFile, JSON.stringify(mutableSession));
    });
  }
}

function loadSession(name, session) {
  // console.log('loadSession')
  const existingSessions = getSessions();
  const cookies = existingSessions[name]?.cookies || [];
  const sessionFile = path.join(app.getPath("userData"), "sessions.json");
  if (fs.existsSync(sessionFile)) {
    session.clearStorageData();
    cookies.forEach((cookie) => {
      // console.log('load, cookie', cookie);
      const url = `https://${cookie.domain.replace(/^\./, "")}`;
      if (cookie.name.startsWith("__Secure-")) cookie.secure = true; // flag safe
      if (cookie.name.startsWith("__Host-")) {
        cookie.secure = true; // flag safe
        cookie.path = "/"; // set root path
        delete cookie.domain; // delete, refer to url
        delete cookie.sameSite; // allow cookies from third auth
      }
      session.cookies
        .set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expirationDate,
        })
        .then(() => {
          // console.log(`${url} cookie ${cookie.name} restored`);
        })
        .catch((error) => {
          console.error("Error while opening cookie :", error);
        });
    });
    win.reload();
  }
}

function generateMenu() {
  const sessionMenuTemplate = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "quit" }, // Cmd + Q pour quitter
            ],
          },
        ]
      : []),
    // Edition Menu
    ...(isMac
      ? [
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
        ]
      : []),
    {
      label: "Change AI",
      submenu: availableAIs
        .filter(({ available }) => available)
        .map(({ label, url }) => ({
          label,
          type: "checkbox",
          checked:
            (userSettings.assistant || defaultSettings.assistant) === label,
          click() {
            changeAssistant(label, url, true);
          },
        })),
        
    },
    {
      label: "Sessions",
      submenu: [
        ...getSessionsNames().map((name) => ({
          label: name,
          click() {
            loadSession(name, session.defaultSession);
          },
        })),
        {
          type: "separator",
        },
        {
          label: "Save Current Session",
          click: async () => {
            const ask = () => {
              prompt({
                title: "Saving Current Session",
                label: "Please chose a name:",
                inputAttrs: {
                  type: "text",
                },
                type: "input",
              })
                .then((text) => {
                  if (text === "") ask();
                  else if (text !== null) {
                    storeSession(text, session.defaultSession);
                    setTimeout(() => loadSession(text, session.defaultSession));
                  }
                })
                .catch(console.error);
            };
            ask();
          },
        },
        {
          label: "Delete A Session",
          click: async () => {
            const ask = () => {
              prompt({
                title: "Delete A Session",
                label: "Enter the EXACT NAME to remove:",
                inputAttrs: {
                  type: "text",
                },
                type: "input",
              })
                .then((text) => {
                  if (text === "") ask();
                  else if (text !== null)
                    removeSession(text, session.defaultSession);
                })
                .catch(console.error);
            };
            ask();
          },
        },
      ],
    },
    {
      label: "Theme",
      submenu: fetchThemes().map((str) => ({
        label: str,
        click() {
          changeUserTheme(str, true);
        },
      })),
    },
    /*
    {
      label: "Options",
      submenu: [
        {
          label: "Streamer mode",
          type: "checkbox",
          checked: loadUserPreferences().streamer,
          click() {
            toggleStreamer();
          },
        },
      ],
    },
    */
    {
      label: "Settings",
      submenu: [
        {
          label: "Theme",
          submenu: fetchThemes().map((str) => ({
            label: str,
            click() {changeUserTheme(str, true)}
          }))
        },
        {
          label: "Options",
          submenu: [
            {
              label: "Streamer mode",
              type: "checkbox",
              checked: loadUserPreferences().streamer,
              click() {
                toggleStreamer();
              },
            },
          ],
        },
        {
          label: "Available AIs",
          submenu: availableAIs.map(({ label, id, available }) => ({
            label,
            type: "checkbox",
            checked: available === true,
            click() {
              toggleAvailableAI(id);
            },
          })),
        },
        {
          type: "separator",
        },
        {
          label: "Add a new AI",
          click: addNewAIPrompt(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(sessionMenuTemplate);
  Menu.setApplicationMenu(menu);
}

function toggleAvailableAI(id) {
  const aiIndex = availableAIs.findIndex((ai) => ai.id === id);
  if (aiIndex !== -1) {
    availableAIs[aiIndex].available = !availableAIs[aiIndex].available;
    fs.writeFileSync(
      path.join(__dirname, "settings.json"),
      JSON.stringify({ availableAIs }, null, 2)
    );
    generateMenu();
  }
}

function addNewAIPrompt() {
  return async () => {
    const aiName = await prompt({
      title: "Add a new AI",
      label: "Please enter the AI's name",
      inputAttrs: {
        type: "text",
      },
      type: "input",
    });

    if (aiName === null || aiName.trim() === "") return;

    const aiUrl = await prompt({
      title: "Add a new AI",
      label: "Please enter the AI website link",
      inputAttrs: {
        type: "text",
      },
      type: "input",
    });

    // Should also test if it is a valid link
    if (aiUrl === null || aiUrl.trim() === "") return; // User cancelled the prompt

    // Find the max id of availableAIs to set the new ai's id
    const nextId =
      availableAIs.reduce((maxId, ai) => (ai.id > maxId ? ai.id : maxId), 0) +
      1;

    availableAIs.push({
      label: aiName,
      url: aiUrl,
      available: true,
      id: nextId,
    });

    // Save the updated availableAIs to settings.json
    fs.writeFileSync(
      path.join(__dirname, "settings.json"),
      JSON.stringify({ availableAIs }, null, 2)
    );

    //Optionally, refresh the menu to include the new AI
    generateMenu();
  };
}

function createWindow() {
  screen = require("electron").screen;


  win = new BrowserWindow({
    width: width,
    height: height,
    autoHideMenuBar: true,
    frame: true,
    fullscreenable: false,
    x: 0,
    y: screen.getPrimaryDisplay().workArea.height - height,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      webviewTag: true,
      session: session.defaultSession,
    },
  });

  win.webContents.session.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );

  loadUserPreferences();
  generateMenu();
  const isValidLabel = (label) => availableAIs.find((ai) => ai.label === label);
  const label = isValidLabel(userSettings.assistant)
    ? userSettings.assistant
    : defaultSettings.assistant;
  const { url } = availableAIs.find((ai) => ai.label === label);
  changeAssistant(label, url, false, false);

  win.webContents.on("did-finish-load", (e) => {
    generateMenu();

    changeUserTheme(userSettings.theme);

    const customCssGptMenuClosed = "div.flex-shrink-0.overflow-x-hidden.bg-token-sidebar-surface-primary.max-md\:\!w-0 {width: 0px; visibility: hidden; will-change: auto;}"

    win.webContents.insertCSS(customCssGptMenuClosed);

    if (userSettings.streamer) {
      // hide private data in UI:
      const hideCssRules = [
        // ChatGPT
        "body div.composer-parent div.draggable button.rounded-full { background: rgba(255,255,255,.5); color: transparent !important; }", // avatar top right (container)
        "body div.composer-parent div.draggable button.rounded-full img { opacity: 0 !important; }", // avatar top right (img)
        "body nav.flex.h-full div.flex.w-full div.items-center.rounded-full { background-color: rgba(255,255,255,.5); }", // avatar in mobile menu (container)
        "body nav.flex.h-full button img { opacity: 0 !important; }", // avatar in mobile menu (img)
        "body nav.flex.h-full div.flex.w-full button div.relative { opacity: 0 !important; }", // name in mobile menu
        "body nav.flex.h-full div.popover.absolute nav div.text-token-text-secondary { display: none; }", // email in mobile menu
        // MistralAI
        "body div.relative.h-full button.inline-flex.items-center.whitespace-nowrap.text-sm * { color: transparent !important; }", // account
        "body div.bg-popover div.flex.flex-col.space-y-1 p { color: transparent !important; }", // mail
        "body div.bg-popover div.px-2.text-xs.font-semibold { color: transparent !important; }", // name
        "body div.group.relative.w-full span.relative.flex { opacity: 0 !important; }", // user avatar
        // Copilot
        "body div.absolute.end-6.top-6 button img { opacity: 0 !important; }", // avatar
        "body div.absolute.end-6.top-6 button p { color: transparent !important; }", // name & mail
      ];
      for (let cssRule of hideCssRules) win.webContents.insertCSS(cssRule);
    }
  });

  win.on("closed", () => {
    win = null;
  });
}

app.commandLine.appendSwitch("disable-software-rasterizer");

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (win === null) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
