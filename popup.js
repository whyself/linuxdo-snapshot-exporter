const scopeEl = document.getElementById("scope");
const exportBtn = document.getElementById("exportBtn");
const statusEl = document.getElementById("status");

scopeEl.value = "op_only";

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = "status";
  if (type) {
    statusEl.classList.add(type);
  }
}

function downloadMarkdown(markdown, filename) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  chrome.downloads.download(
    {
      url: blobUrl,
      filename,
      saveAs: true
    },
    () => {
      URL.revokeObjectURL(blobUrl);
      if (chrome.runtime.lastError) {
        setStatus(`下载失败：${chrome.runtime.lastError.message}`, "error");
        exportBtn.disabled = false;
        return;
      }
      setStatus("导出成功，已打开保存对话框。", "ok");
      exportBtn.disabled = false;
    }
  );
}

function requestExport(scope) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      setStatus("无法获取当前标签页。", "error");
      exportBtn.disabled = false;
      return;
    }

    chrome.tabs.sendMessage(
      tab.id,
      { type: "EXPORT_MARKDOWN", scope },
      (response) => {
        if (chrome.runtime.lastError) {
          setStatus(
            "当前页面无法通信，请确认你在 linux.do 的帖子页后重试。",
            "error"
          );
          exportBtn.disabled = false;
          return;
        }

        if (!response) {
          setStatus("导出失败：未收到内容脚本响应。", "error");
          exportBtn.disabled = false;
          return;
        }

        if (!response.ok) {
          setStatus(response.error || "导出失败。", "error");
          exportBtn.disabled = false;
          return;
        }

        downloadMarkdown(response.markdown, response.filename);
      }
    );
  });
}

exportBtn.addEventListener("click", () => {
  exportBtn.disabled = true;
  setStatus("正在抓取并转换 Markdown...", "");
  requestExport(scopeEl.value);
});
