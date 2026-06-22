const MODEL_DB_NAME = "screen-ocr-models";
const MODEL_DB_VERSION = 1;
const MODEL_STORE_NAME = "custom-model";
const MODEL_KEY_ONNX = "model";
const MODEL_KEY_CONFIG = "config";
const MODEL_KEY_META = "meta";

const refs = {
  readyPill: document.getElementById("readyPill"),
  sourceValue: document.getElementById("sourceValue"),
  nameValue: document.getElementById("nameValue"),
  modelValue: document.getElementById("modelValue"),
  charsValue: document.getElementById("charsValue"),
  ioValue: document.getElementById("ioValue"),
  savedValue: document.getElementById("savedValue"),
  form: document.getElementById("modelForm"),
  displayName: document.getElementById("displayName"),
  onnxFile: document.getElementById("onnxFile"),
  configFile: document.getElementById("configFile"),
  saveButton: document.getElementById("saveButton"),
  resetButton: document.getElementById("resetButton"),
  refreshButton: document.getElementById("refreshButton"),
  shortcutValue: document.getElementById("shortcutValue"),
  shortcutButton: document.getElementById("shortcutButton"),
  message: document.getElementById("message")
};

refs.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCustomModel();
});

refs.resetButton.addEventListener("click", async () => {
  await resetModel();
});

refs.refreshButton.addEventListener("click", async () => {
  await refreshStatus();
});

refs.shortcutButton.addEventListener("click", () => {
  openShortcutPage();
});

refreshStatus();
refreshShortcut();

async function saveCustomModel() {
  const modelFile = refs.onnxFile.files && refs.onnxFile.files[0];
  const configFile = refs.configFile.files && refs.configFile.files[0];

  if (!modelFile) {
    setMessage("Select an ONNX model file.", "error");
    return;
  }

  if (!configFile) {
    setMessage("Select the matching inference.yml file.", "error");
    return;
  }

  setBusy(true);
  setMessage("Saving model...", "");

  try {
    const modelBuffer = await modelFile.arrayBuffer();
    const configText = await configFile.text();
    const displayName = refs.displayName.value.trim() || modelFile.name.replace(/\.onnx$/i, "");
    const meta = {
      name: displayName,
      modelFileName: modelFile.name,
      configFileName: configFile.name,
      modelBytes: modelBuffer.byteLength,
      configBytes: byteLengthOfText(configText),
      savedAt: new Date().toISOString()
    };

    const db = await openModelDb();
    await modelDbPutMany(db, [
      [MODEL_KEY_ONNX, modelBuffer],
      [MODEL_KEY_CONFIG, configText],
      [MODEL_KEY_META, meta]
    ]);
    db.close();

    setMessage("Reloading model...", "");
    const response = await sendMessage({ action: "reloadModel" });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Model reload failed");
    }

    renderStatus(response.status);
    setMessage("Custom model is active.", "ok");
  } catch (error) {
    setMessage(error.message || String(error), "error");
    await refreshStatus(false);
  } finally {
    setBusy(false);
  }
}

async function resetModel() {
  setBusy(true);
  setMessage("Resetting model...", "");

  try {
    const db = await openModelDb();
    await modelDbDeleteMany(db, [MODEL_KEY_ONNX, MODEL_KEY_CONFIG, MODEL_KEY_META]);
    db.close();

    const response = await sendMessage({ action: "reloadModel" });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Model reload failed");
    }

    refs.displayName.value = "";
    refs.onnxFile.value = "";
    refs.configFile.value = "";
    renderStatus(response.status);
    setMessage("Bundled tiny model is active.", "ok");
  } catch (error) {
    setMessage(error.message || String(error), "error");
    await refreshStatus(false);
  } finally {
    setBusy(false);
  }
}

async function refreshStatus(showMessage = true) {
  setBusy(true);
  if (showMessage) setMessage("Refreshing...", "");

  try {
    const response = await sendMessage({ action: "modelStatus" });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Status unavailable");
    }
    renderStatus(response.status);
    if (showMessage) setMessage("", "");
  } catch (error) {
    setMessage(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

function renderStatus(status) {
  const source = status && status.source === "custom" ? "Custom" : "Bundled";
  refs.readyPill.textContent = status && status.ready ? "Ready" : "Error";
  refs.readyPill.className = status && status.ready ? "pill ok" : "pill error";
  refs.sourceValue.textContent = source;
  refs.nameValue.textContent = status && status.name ? status.name : "-";
  refs.modelValue.textContent = formatModelLine(status);
  refs.charsValue.textContent = status && status.characters ? String(status.characters) : "-";
  refs.ioValue.textContent = status && status.input ? `${status.input} / ${status.output || "-"}` : "-";
  refs.savedValue.textContent = status && status.savedAt ? formatDate(status.savedAt) : "-";

  if (status && status.error) {
    setMessage(status.error, "error");
  }
}

function formatModelLine(status) {
  if (!status) return "-";
  const pieces = [];
  if (status.modelFileName) pieces.push(status.modelFileName);
  if (status.modelBytes) pieces.push(formatBytes(status.modelBytes));
  if (status.configFileName) pieces.push(status.configFileName);
  if (!pieces.length && status.modelBytes) pieces.push(formatBytes(status.modelBytes));
  return pieces.length ? pieces.join(" | ") : "-";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setBusy(isBusy) {
  refs.saveButton.disabled = isBusy;
  refs.resetButton.disabled = isBusy;
  refs.refreshButton.disabled = isBusy;
}

function setMessage(text, tone) {
  refs.message.textContent = text || "";
  refs.message.className = tone ? `message ${tone}` : "message";
}

function refreshShortcut() {
  if (!chrome.commands || !chrome.commands.getAll) {
    refs.shortcutValue.textContent = "Ctrl+Shift+Z";
    return;
  }

  chrome.commands.getAll((commands) => {
    const error = chrome.runtime.lastError;
    if (error) {
      refs.shortcutValue.textContent = "Ctrl+Shift+Z";
      return;
    }

    const selectCommand = (commands || []).find((command) => command.name === "select");
    refs.shortcutValue.textContent = selectCommand && selectCommand.shortcut
      ? selectCommand.shortcut
      : "未设置";
  });
}

function openShortcutPage() {
  try {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        setMessage("请打开 chrome://extensions/shortcuts 修改快捷键。", "error");
      }
    });
  } catch (error) {
    setMessage("请打开 chrome://extensions/shortcuts 修改快捷键。", "error");
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function openModelDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MODEL_DB_NAME, MODEL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MODEL_STORE_NAME)) {
        db.createObjectStore(MODEL_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open model storage"));
  });
}

function modelDbPutMany(db, entries) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MODEL_STORE_NAME, "readwrite");
    const store = transaction.objectStore(MODEL_STORE_NAME);
    for (const entry of entries) {
      store.put(entry[1], entry[0]);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Failed to save model"));
  });
}

function modelDbDeleteMany(db, keys) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MODEL_STORE_NAME, "readwrite");
    const store = transaction.objectStore(MODEL_STORE_NAME);
    for (const key of keys) {
      store.delete(key);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Failed to delete model"));
  });
}

function byteLengthOfText(text) {
  return new TextEncoder().encode(text || "").byteLength;
}
