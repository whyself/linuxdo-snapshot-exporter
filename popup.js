const scopeEl = document.getElementById("scope");
const exportBtn = document.getElementById("exportBtn");
const exportImageBtn = document.getElementById("exportImageBtn");
const statusEl = document.getElementById("status");
const CAPTURE_MIN_INTERVAL_MS = 650;
let lastCaptureAt = 0;

scopeEl.value = "op_only";

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = "status";
  if (type) {
    statusEl.classList.add(type);
  }
}

function setBusy(isBusy) {
  exportBtn.disabled = isBusy;
  exportImageBtn.disabled = isBusy;
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        reject(new Error("无法获取当前标签页。"));
        return;
      }
      resolve(tab);
    });
  });
}

function sendMessageToTab(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function shouldRetryByInjection(message) {
  if (!message) {
    return false;
  }
  const text = String(message).toLowerCase();
  return (
    text.includes("receiving end does not exist") ||
    text.includes("message port closed before a response was received")
  );
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content-script.js"]
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

async function sendMessageWithRetry(tabId, payload) {
  try {
    return await sendMessageToTab(tabId, payload);
  } catch (error) {
    if (!shouldRetryByInjection(error.message)) {
      throw error;
    }

    await injectContentScript(tabId);
    await sleep(120);
    return sendMessageToTab(tabId, payload);
  }
}

function captureVisible(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!dataUrl) {
        reject(new Error("截图失败，未获取到图像数据。"));
        return;
      }
      resolve(dataUrl);
    });
  });
}

async function captureVisibleThrottled(windowId) {
  const now = Date.now();
  const waitMs = CAPTURE_MIN_INTERVAL_MS - (now - lastCaptureAt);
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  const dataUrl = await captureVisible(windowId);
  lastCaptureAt = Date.now();
  return dataUrl;
}

function downloadBlob(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: blobUrl, filename, saveAs: true },
      () => {
        URL.revokeObjectURL(blobUrl);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFilename(name, ext) {
  const base = String(name || "snapshot")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "snapshot"}.${ext}`;
}

async function exportMarkdown() {
  setBusy(true);
  setStatus("正在抓取并转换 Markdown...", "");

  try {
    const tab = await getActiveTab();
    const response = await sendMessageWithRetry(tab.id, {
      type: "EXPORT_MARKDOWN",
      scope: scopeEl.value
    });

    if (!response) {
      throw new Error("导出失败：未收到内容脚本响应。");
    }
    if (!response.ok) {
      throw new Error(response.error || "导出 Markdown 失败。");
    }

    const blob = new Blob([response.markdown], { type: "text/markdown;charset=utf-8" });
    await downloadBlob(blob, response.filename);
    setStatus("Markdown 导出成功，已打开保存对话框。", "ok");
  } catch (error) {
    setStatus(
      `导出失败：${error.message || "请确认你在 linux.do 的帖子页面后重试。"}`,
      "error"
    );
  } finally {
    setBusy(false);
  }
}

async function dataUrlToBitmap(dataUrl) {
  const imageBlob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(imageBlob);
}

function buildCapturePositions(totalHeight, viewportHeight, offsetY = 0) {
  const maxY = Math.max(0, totalHeight - viewportHeight);
  const positions = [];
  for (let y = offsetY; y < offsetY + totalHeight; y += viewportHeight) {
    positions.push(Math.min(y, maxY));
  }
  if (positions.length === 0) {
    positions.push(Math.min(offsetY, maxY));
  }

  return positions.filter((value, index) => index === 0 || value !== positions[index - 1]);
}

async function exportLongImage() {
  setBusy(true);
  setStatus("正在生成长图，请勿切换标签页...", "");

  let tab = null;
  let sessionStarted = false;

  try {
    tab = await getActiveTab();
    const start = await sendMessageWithRetry(tab.id, {
      type: "LONGSHOT_START",
      scope: scopeEl.value
    });
    if (!start || !start.ok) {
      throw new Error("当前页面不支持长图导出，请先打开 linux.do 帖子页。");
    }

    sessionStarted = true;

    const totalHeight = Number(start.captureHeight || 0);
    const captureX = Number(start.captureX || 0);
    const captureY = Number(start.captureY || 0);
    const captureWidth = Number(start.captureWidth || start.viewportWidth || 0);
    const viewportHeight = Number(start.viewportHeight || 0);
    const viewportWidth = Number(start.viewportWidth || 0);
    if (totalHeight <= 0 || viewportHeight <= 0 || captureWidth <= 0 || viewportWidth <= 0) {
      throw new Error("页面尺寸无效，无法执行长图导出。");
    }

    const positions = buildCapturePositions(totalHeight, viewportHeight, captureY);

    let canvas = null;
    let ctx = null;
    let ratio = 1;

    for (let i = 0; i < positions.length; i += 1) {
      const y = positions[i];
      await sendMessageWithRetry(tab.id, { type: "LONGSHOT_SCROLL", y });
      await sleep(180);

      const frameDataUrl = await captureVisibleThrottled(tab.windowId);
      const bitmap = await dataUrlToBitmap(frameDataUrl);

      if (!canvas) {
        ratio = bitmap.width / Math.max(1, start.viewportWidth || 1);
        canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(captureWidth * ratio));
        canvas.height = Math.max(1, Math.round(totalHeight * ratio));
        ctx = canvas.getContext("2d");
        if (!ctx) {
          bitmap.close();
          throw new Error("无法创建画布上下文。");
        }
      }

      const viewportTop = y;
      const viewportBottom = y + viewportHeight;
      const regionTop = captureY;
      const regionBottom = captureY + totalHeight;
      const drawTop = Math.max(regionTop, viewportTop);
      const drawBottom = Math.min(regionBottom, viewportBottom);
      const drawHeightCss = drawBottom - drawTop;

      if (drawHeightCss > 0) {
        const sourceX = Math.max(0, Math.round(captureX * ratio));
        const sourceY = Math.max(0, Math.round((drawTop - viewportTop) * ratio));
        const sourceW = Math.min(bitmap.width - sourceX, Math.round(captureWidth * ratio));
        const sourceH = Math.min(bitmap.height - sourceY, Math.round(drawHeightCss * ratio));
        const destY = Math.round((drawTop - regionTop) * ratio);

        if (sourceW > 0 && sourceH > 0) {
          ctx.drawImage(
            bitmap,
            sourceX,
            sourceY,
            sourceW,
            sourceH,
            0,
            destY,
            sourceW,
            sourceH
          );
        }
      }

      bitmap.close();
      setStatus(`正在拼接长图 (${i + 1}/${positions.length})...`, "");
    }

    if (!canvas) {
      throw new Error("没有可用截图帧。");
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error("长图编码失败。");
    }

    const filename = sanitizeFilename(tab.title || "linuxdo-topic", "png");
    await downloadBlob(blob, filename);
    setStatus("长图导出成功，已打开保存对话框。", "ok");
  } catch (error) {
    setStatus(`长图导出失败：${error.message || "未知错误"}`, "error");
  } finally {
    if (tab && tab.id && sessionStarted) {
      try {
        await sendMessageWithRetry(tab.id, { type: "LONGSHOT_END" });
      } catch {
        // ignore
      }
    }
    setBusy(false);
  }
}

exportBtn.addEventListener("click", () => {
  exportMarkdown();
});

exportImageBtn.addEventListener("click", () => {
  exportLongImage();
});
