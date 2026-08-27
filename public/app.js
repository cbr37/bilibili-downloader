/**
 * B站视频音频下载工具 - 前端逻辑
 */

// DOM 元素引用
const $ = (id) => document.getElementById(id);

const urlInput = $("urlInput");
const urlInputBox = $("urlInputBox");
const parseBtn = $("parseBtn");
const parseBtnText = $("parseBtnText");
const parseBtnLoader = $("parseBtnLoader");

const videoCardWrapper = $("videoCardWrapper");
const videoThumbnail = $("videoThumbnail");
const videoDuration = $("videoDuration");
const videoTitle = $("videoTitle");
const videoUploader = $("videoUploader");
const videoViews = $("videoViews");
const metaViews = $("metaViews");
const downloadAudioBtn = $("downloadAudioBtn");
const downloadVideoBtn = $("downloadVideoBtn");

const downloadProgress = $("downloadProgress");
const progressLabel = $("progressLabel");
const progressPercent = $("progressPercent");
const progressBar = $("progressBar");
const progressStatus = $("progressStatus");
const cancelBtn = $("cancelBtn");

const downloadComplete = $("downloadComplete");
const completeDesc = $("completeDesc");
const downloadFileBtn = $("downloadFileBtn");

const toastContainer = $("toastContainer");

// 状态管理
let currentVideoInfo = null;
let currentEventSource = null;
let currentFormat = null;

// ===== 工具函数 =====

// 格式化时长
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 格式化数字（播放量等）
function formatNumber(num) {
  if (!num) return "0";
  if (num >= 100000000) return (num / 100000000).toFixed(1) + "亿";
  if (num >= 10000) return (num / 10000).toFixed(1) + "万";
  return num.toString();
}

// 显示 Toast 通知
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastOut .3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// 验证B站URL
function isValidBilibiliUrl(url) {
  const patterns = [
    /^https?:\/\/(www\.)?bilibili\.com\/video\/.+/,
    /^https?:\/\/b23\.tv\/.+/,
    /^https?:\/\/m\.bilibili\.com\/video\/.+/,
    /^https?:\/\/(www\.)?bilibili\.com\/bangumi\/.+/,
  ];
  return patterns.some((p) => p.test(url.trim()));
}

// ===== 解析视频 =====

async function parseVideo() {
  const url = urlInput.value.trim();

  if (!url) {
    urlInputBox.classList.add("error");
    showToast("请输入视频链接", "error");
    return;
  }

  if (!isValidBilibiliUrl(url)) {
    urlInputBox.classList.add("error");
    showToast("请输入有效的B站视频链接", "error");
    return;
  }

  urlInputBox.classList.remove("error");
  urlInputBox.classList.add("loading");
  parseBtnText.hidden = true;
  parseBtnLoader.hidden = false;
  videoCardWrapper.hidden = true;

  try {
    const response = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "解析失败");
    }

    currentVideoInfo = data;
    displayVideoInfo(data);
  } catch (error) {
    showToast(error.message || "解析视频信息失败", "error");
  } finally {
    urlInputBox.classList.remove("loading");
    parseBtnText.hidden = false;
    parseBtnLoader.hidden = true;
  }
}

// 显示视频信息
function displayVideoInfo(info) {
  videoTitle.textContent = info.title;
  videoUploader.textContent = info.uploader;

  if (info.duration > 0) {
    videoDuration.textContent = formatDuration(info.duration);
    videoDuration.hidden = false;
  } else {
    videoDuration.hidden = true;
  }

  if (info.viewCount > 0) {
    videoViews.textContent = formatNumber(info.viewCount) + " 播放";
    metaViews.hidden = false;
  } else {
    metaViews.hidden = true;
  }

  if (info.thumbnail) {
    videoThumbnail.src = `/api/proxy?url=${encodeURIComponent(info.thumbnail)}`;
    videoThumbnail.onerror = () => {
      videoThumbnail.style.display = "none";
    };
  }

  // 重置下载状态
  downloadProgress.hidden = true;
  downloadComplete.hidden = true;
  downloadAudioBtn.disabled = false;
  downloadVideoBtn.disabled = false;

  videoCardWrapper.hidden = false;

  // 平滑滚动到视频卡片
  videoCardWrapper.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ===== 下载功能 =====

function startDownload(format) {
  if (!currentVideoInfo) return;

  currentFormat = format;
  const formatLabel = format === "audio" ? "音频（MP3）" : "视频（MP4）";

  // 重置 UI
  downloadComplete.hidden = true;
  downloadProgress.hidden = false;
  downloadAudioBtn.disabled = true;
  downloadVideoBtn.disabled = true;
  cancelBtn.hidden = false;

  progressLabel.textContent = `正在下载${formatLabel}...`;
  progressPercent.textContent = "0%";
  progressBar.style.width = "0%";
  progressStatus.textContent = "正在连接服务器...";

  // 关闭之前的 EventSource
  if (currentEventSource) {
    currentEventSource.close();
  }

  // 使用 fetch + ReadableStream 处理 SSE
  const controller = new AbortController();

  fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: currentVideoInfo.url, format }),
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("下载请求失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function readChunk() {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) return;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const event = JSON.parse(line.slice(6));
                  handleDownloadEvent(event, controller);
                } catch (e) {
                  // 忽略解析错误
                }
              }
            }

            readChunk();
          })
          .catch((err) => {
            if (err.name !== "AbortError") {
              console.error("读取错误:", err);
            }
          });
      }

      readChunk();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        showToast("下载请求失败", "error");
        resetDownloadUI();
      }
    });

  // 保存 controller 以便取消
  currentEventSource = { close: () => controller.abort() };

  // 取消按钮
  cancelBtn.onclick = () => {
    if (currentEventSource) {
      currentEventSource.close();
      currentEventSource = null;
    }
    resetDownloadUI();
    showToast("已取消下载", "info");
  };
}

// 处理下载事件
function handleDownloadEvent(event, controller) {
  const stageLabels = {
    fetching: "正在获取视频信息...",
    downloading: "正在下载音频流...",
    "downloading-video": "正在下载视频流...",
    "downloading-audio": "正在下载音频流...",
    converting: "正在转换为 MP3...",
    merging: "正在合并视频和音频...",
  };

  switch (event.type) {
    case "start":
      progressStatus.textContent = "正在初始化...";
      break;

    case "progress":
      const percent = Math.min(Math.round(event.percent), 99);
      progressBar.style.width = percent + "%";
      progressPercent.textContent = percent + "%";

      if (event.stage && stageLabels[event.stage]) {
        progressLabel.textContent = stageLabels[event.stage];
        progressStatus.textContent = stageLabels[event.stage];
      }
      break;

    case "complete":
      progressLabel.textContent = "下载完成！";
      progressPercent.textContent = "100%";
      progressBar.style.width = "100%";
      progressStatus.textContent = "";

      const formatName = currentFormat === "audio" ? "音频" : "视频";
      completeDesc.textContent = `${currentVideoInfo.title} - ${formatName}已准备就绪`;

      downloadFileBtn.href = `/api/file/${event.fileId}`;

      setTimeout(() => {
        downloadProgress.hidden = true;
        downloadComplete.hidden = false;
        downloadComplete.scrollIntoView({ behavior: "smooth", block: "center" });
        showToast("下载完成，请点击保存文件", "success");
      }, 500);

      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
      }
      cancelBtn.hidden = true;
      downloadAudioBtn.disabled = false;
      downloadVideoBtn.disabled = false;
      break;

    case "error":
      showToast(event.error || "下载失败", "error");
      resetDownloadUI();
      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
      }
      break;
  }
}

// 重置下载UI
function resetDownloadUI() {
  downloadProgress.hidden = true;
  downloadComplete.hidden = true;
  downloadAudioBtn.disabled = false;
  downloadVideoBtn.disabled = false;
  cancelBtn.hidden = true;
}

// ===== 事件绑定 =====

// 解析按钮
parseBtn.addEventListener("click", parseVideo);

// 回车解析
urlInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    parseVideo();
  }
});

// 输入时移除错误状态
urlInput.addEventListener("input", () => {
  urlInputBox.classList.remove("error");
});

// 下载按钮
downloadAudioBtn.addEventListener("click", () => startDownload("audio"));
downloadVideoBtn.addEventListener("click", () => startDownload("video"));

// 粘贴自动解析
let pasteTimer = null;
urlInput.addEventListener("paste", () => {
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(() => {
    const url = urlInput.value.trim();
    if (isValidBilibiliUrl(url)) {
      parseVideo();
    }
  }, 300);
});

// 保存文件按钮点击后重置状态
downloadFileBtn.addEventListener("click", () => {
  setTimeout(() => {
    setTimeout(() => {
      downloadComplete.hidden = true;
    }, 2000);
  }, 100);
});

// 页面加载时聚焦输入框
window.addEventListener("DOMContentLoaded", () => {
  urlInput.focus();
});
