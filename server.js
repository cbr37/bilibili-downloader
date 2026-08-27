import express from "express";
import cors from "cors";
import { spawn, exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import {
  existsSync,
  unlinkSync,
  statSync,
  readdirSync,
  mkdirSync,
} from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const TMP_DIR = join(__dirname, "tmp");
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

const downloadJobs = new Map();
const activeProcesses = new Map();

// 清理过期文件
setInterval(() => {
  const now = Date.now();
  if (existsSync(TMP_DIR)) {
    for (const file of readdirSync(TMP_DIR)) {
      const filePath = join(TMP_DIR, file);
      try {
        if (now - statSync(filePath).mtimeMs > 3600000) {
          unlinkSync(filePath);
        }
      } catch (e) {}
    }
  }
}, 300000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 使用 curl 调用B站API（自动使用代理环境变量）
async function bilibiliApiGet(url) {
  let lastError = null;
  // 重试 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execAsync(
        `curl -s -L --connect-timeout 10 --max-time 30 "${url}" -H "User-Agent: ${UA}" -H "Referer: https://www.bilibili.com/"`,
        { maxBuffer: 50 * 1024 * 1024 }
      );
      if (!stdout || stdout.trim() === "") {
        throw new Error("API返回空响应");
      }
      return JSON.parse(stdout);
    } catch (err) {
      lastError = err;
      // 等待 1 秒后重试
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
  throw new Error("请求B站API超时，请稍后重试");
}

// ===== URL 解析 =====

// 从 URL 中提取 BV 号
function extractBvId(url) {
  const match = url.match(/BV[a-zA-Z0-9]{10}/);
  return match ? match[0] : null;
}

// 解析 b23.tv 短链接，返回最终 URL
async function resolveShortUrl(url) {
  try {
    const { stdout } = await execAsync(
      `curl -s -o /dev/null -w "%{url_effective}" --max-time 10 "${url}" -H "User-Agent: ${UA}"`,
      { maxBuffer: 1024 }
    );
    return stdout.trim() || url;
  } catch {
    return url;
  }
}

// 验证并解析B站URL
async function parseBilibiliUrl(url) {
  const trimmed = url.trim();

  // 处理短链接
  let resolvedUrl = trimmed;
  if (trimmed.includes("b23.tv")) {
    resolvedUrl = await resolveShortUrl(trimmed);
  }

  const bvid = extractBvId(resolvedUrl);
  if (!bvid) {
    return null;
  }

  return { bvid, url: resolvedUrl };
}

// ===== B站 API =====

// 获取视频信息
async function getVideoInfo(bvid) {
  const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  const data = await bilibiliApiGet(apiUrl);

  if (data.code !== 0) {
    throw new Error(data.message || "获取视频信息失败");
  }

  const d = data.data;
  return {
    title: d.title,
    thumbnail: d.pic,
    duration: d.duration,
    uploader: d.owner?.name || "未知",
    viewCount: d.stat?.view || 0,
    likeCount: d.stat?.like || 0,
    cid: d.cid,
    aid: d.aid,
    bvid: d.bvid,
    desc: d.desc,
  };
}

// 获取播放地址（DASH 流）
async function getStreamUrls(bvid, cid) {
  const apiUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=4048&fourk=1`;
  const data = await bilibiliApiGet(apiUrl);

  if (data.code !== 0) {
    throw new Error(data.message || "获取播放地址失败");
  }

  const d = data.data;
  if (!d.dash) {
    throw new Error("该视频暂不支持DASH格式下载");
  }

  // 选择最佳视频流（优先 avc1 编码，兼容性最好）
  const videos = d.dash.video || [];
  const avcVideos = videos.filter((v) =>
    (v.codecs || "").startsWith("avc1")
  );
  const bestVideo =
    (avcVideos.length > 0 ? avcVideos : videos).sort(
      (a, b) => (b.width || 0) - (a.width || 0)
    )[0] || null;

  // 选择最佳音频流
  const audios = d.dash.audio || [];
  const bestAudio = audios.sort(
    (a, b) => (b.bandwidth || 0) - (a.bandwidth || 0)
  )[0] || null;

  // 可用画质列表
  const qualities = (d.accept_quality || []).map((qn) => {
    const labels = {
      127: "8K 超高清",
      126: "杜比视界",
      125: "HDR 真彩",
      120: "4K 超清",
      116: "1080P60",
      112: "1080P 高码率",
      80: "1080P 高清",
      74: "720P60",
      64: "720P",
      48: "480P",
      32: "360P",
      16: "240P",
    };
    return { qn, label: labels[qn] || `${qn}P` };
  });

  return {
    video: bestVideo,
    audio: bestAudio,
    qualities,
    currentQuality: d.quality,
    supportFormats: d.support_formats || [],
  };
}

// 下载流文件（使用 curl，返回 Promise + 进度回调）
function downloadStream(url, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      "-L",
      "--connect-timeout", "15",
      "--max-time", "120",
      "-o",
      outputPath,
      "-H",
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "-H",
      "Referer: https://www.bilibili.com/",
      "--progress-bar",
      url,
    ];

    const curl = spawn("curl", args);
    let stderrData = "";

    curl.stderr.on("data", (data) => {
      const text = data.toString();
      stderrData += text;
      // curl --progress-bar 输出格式: ###  50.0%
      const match = text.match(/([0-9.]+)%/);
      if (match && onProgress) {
        onProgress(parseFloat(match[1]));
      }
    });

    curl.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`下载失败 (exit code: ${code})`));
      }
    });

    curl.on("error", (err) => {
      reject(err);
    });
  });
}

// 使用 ffmpeg 转换音频为 MP3
function convertToMp3(inputPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-codec:a",
      "libmp3lame",
      "-qscale:a",
      "2",
      "-y",
      outputPath,
    ]);

    let stderrData = "";

    ffmpeg.stderr.on("data", (data) => {
      const text = data.toString();
      stderrData += text;
      // 解析 ffmpeg 进度（通过 time 和 duration 计算）
      const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
      if (timeMatch && onProgress) {
        const totalSec = onProgress._duration || 0;
        if (totalSec > 0) {
          const h = parseInt(timeMatch[1]);
          const m = parseInt(timeMatch[2]);
          const s = parseInt(timeMatch[3]);
          const ms = parseInt(timeMatch[4]) / 100;
          const current = h * 3600 + m * 60 + s + ms;
          const percent = Math.min((current / totalSec) * 100, 99);
          onProgress(percent);
        }
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`音频转换失败 (exit code: ${code})`));
      }
    });

    ffmpeg.on("error", (err) => reject(err));
  });
}

// 使用 ffmpeg 合并视频和音频
function mergeVideoAudio(
  videoPath,
  audioPath,
  outputPath,
  duration,
  onProgress
) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-strict",
      "experimental",
      "-y",
      outputPath,
    ]);

    ffmpeg.stderr.on("data", (data) => {
      const text = data.toString();
      const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
      if (timeMatch && duration > 0) {
        const h = parseInt(timeMatch[1]);
        const m = parseInt(timeMatch[2]);
        const s = parseInt(timeMatch[3]);
        const ms = parseInt(timeMatch[4]) / 100;
        const current = h * 3600 + m * 60 + s + ms;
        const percent = Math.min((current / duration) * 100, 99);
        if (onProgress) onProgress(percent);
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`视频合并失败 (exit code: ${code})`));
      }
    });

    ffmpeg.on("error", (err) => reject(err));
  });
}

// ===== API 路由 =====

// 获取视频信息
app.post("/api/info", async (req, res) => {
  const { url } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: "请输入视频链接" });
  }

  try {
    const parsed = await parseBilibiliUrl(url);
    if (!parsed) {
      return res
        .status(400)
        .json({ error: "无法识别视频链接，请检查是否为B站视频URL" });
    }

    const info = await getVideoInfo(parsed.bvid);
    const streams = await getStreamUrls(parsed.bvid, info.cid);

    res.json({
      ...info,
      url: parsed.url,
      videoInfo: streams.video
        ? {
            width: streams.video.width,
            height: streams.video.height,
            codecs: streams.video.codecs,
          }
        : null,
      audioInfo: streams.audio
        ? {
            bandwidth: streams.audio.bandwidth,
            codecs: streams.audio.codecs,
          }
        : null,
      currentQuality: streams.currentQuality,
    });
  } catch (error) {
    console.error("获取信息失败:", error.message);
    let msg = error.message || "获取视频信息失败";
    // 屏蔽原始命令信息，显示友好提示
    if (msg.includes("Command failed") || msg.includes("curl")) {
      msg = "请求B站API超时，请稍后重试";
    }
    if (msg.includes("Unexpected token") || msg.includes("JSON")) {
      msg = "解析视频信息失败，视频可能已下架或需要登录";
    }
    res.status(500).json({ error: msg });
  }
});

// 下载（SSE 进度流）
app.post("/api/download", async (req, res) => {
  const { url, format } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: "请输入视频链接" });
  }

  const formatType = format === "audio" ? "audio" : "video";
  const jobId = randomUUID();

  // 设置 SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ type: "start", jobId, format: formatType });

  // 清理临时文件
  const tempFiles = [];
  const cleanupTemp = () => {
    for (const f of tempFiles) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch (e) {}
    }
  };

  // 客户端断开处理（用 res 而非 req，避免请求体完成时误触发）
  let aborted = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      aborted = true;
      const proc = activeProcesses.get(jobId);
      if (proc) {
        try {
          proc.kill("SIGTERM");
        } catch (e) {}
      }
    }
  });

  try {
    const parsed = await parseBilibiliUrl(url);
    if (!parsed) {
      sendEvent({ type: "error", error: "无法识别视频链接" });
      return res.end();
    }

    sendEvent({ type: "progress", percent: 0, stage: "fetching" });

    const info = await getVideoInfo(parsed.bvid);
    if (aborted) return res.end();

    const streams = await getStreamUrls(parsed.bvid, info.cid);
    if (aborted) return res.end();

    if (formatType === "audio") {
      // ===== 下载音频 =====
      if (!streams.audio) {
        sendEvent({ type: "error", error: "该视频没有可用的音频流" });
        return res.end();
      }

      sendEvent({
        type: "progress",
        percent: 2,
        stage: "downloading",
        status: "正在下载音频流...",
      });

      const audioRaw = join(TMP_DIR, `${jobId}_raw.m4s`);
      tempFiles.push(audioRaw);

      const audioPath = await downloadStream(
        streams.audio.baseUrl,
        audioRaw,
        (percent) => {
          if (!aborted) {
            // 下载占 2%-50%
            const adjusted = 2 + (percent / 100) * 48;
            sendEvent({
              type: "progress",
              percent: Math.round(adjusted),
              stage: "downloading",
            });
          }
        }
      );

      if (aborted) return res.end();

      // 转换为 MP3
      sendEvent({
        type: "progress",
        percent: 52,
        stage: "converting",
        status: "正在转换为 MP3...",
      });

      const mp3Path = join(TMP_DIR, `${jobId}.mp3`);
      const convProgress = (percent) => {
        if (!aborted) {
          // 转换占 52%-98%
          const adjusted = 52 + (percent / 100) * 46;
          sendEvent({
            type: "progress",
            percent: Math.round(adjusted),
            stage: "converting",
          });
        }
      };
      convProgress._duration = info.duration;
      activeProcesses.set(jobId, null);

      const ffmpeg = spawn("ffmpeg", [
        "-i",
        audioPath,
        "-codec:a",
        "libmp3lame",
        "-qscale:a",
        "2",
        "-y",
        mp3Path,
      ]);
      activeProcesses.set(jobId, ffmpeg);

      await new Promise((resolve, reject) => {
        ffmpeg.stderr.on("data", (data) => {
          const text = data.toString();
          const timeMatch = text.match(
            /time=(\d{2}):(\d{2}):(\d{2})\.(\d+)/
          );
          if (timeMatch && info.duration > 0) {
            const h = parseInt(timeMatch[1]);
            const m = parseInt(timeMatch[2]);
            const s = parseInt(timeMatch[3]);
            const ms = parseInt(timeMatch[4]) / 100;
            const current = h * 3600 + m * 60 + s + ms;
            const percent = Math.min((current / info.duration) * 100, 99);
            const adjusted = 52 + (percent / 100) * 46;
            if (!aborted)
              sendEvent({
                type: "progress",
                percent: Math.round(adjusted),
                stage: "converting",
              });
          }
        });

        ffmpeg.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`转换失败 (code: ${code})`));
        });

        ffmpeg.on("error", (err) => reject(err));
      });

      if (aborted) return res.end();

      // 清理原始文件
      try {
        unlinkSync(audioRaw);
      } catch (e) {}

      // 完成
      downloadJobs.set(jobId, {
        filePath: mp3Path,
        fileName: `${jobId}.mp3`,
        ext: ".mp3",
        createdAt: Date.now(),
      });

      sendEvent({
        type: "complete",
        jobId,
        fileId: jobId,
        fileName: `${jobId}.mp3`,
      });
      activeProcesses.delete(jobId);
    } else {
      // ===== 下载视频 =====
      if (!streams.video) {
        sendEvent({ type: "error", error: "该视频没有可用的视频流" });
        return res.end();
      }

      const videoRaw = join(TMP_DIR, `${jobId}_video.m4s`);
      const audioRaw = join(TMP_DIR, `${jobId}_audio.m4s`);
      tempFiles.push(videoRaw, audioRaw);

      // 下载视频流
      sendEvent({
        type: "progress",
        percent: 2,
        stage: "downloading-video",
        status: "正在下载视频流...",
      });

      await downloadStream(streams.video.baseUrl, videoRaw, (percent) => {
        if (!aborted) {
          // 视频下载占 2%-40%
          const adjusted = 2 + (percent / 100) * 38;
          sendEvent({
            type: "progress",
            percent: Math.round(adjusted),
            stage: "downloading-video",
          });
        }
      });

      if (aborted) return res.end();

      // 下载音频流
      sendEvent({
        type: "progress",
        percent: 42,
        stage: "downloading-audio",
        status: "正在下载音频流...",
      });

      await downloadStream(streams.audio.baseUrl, audioRaw, (percent) => {
        if (!aborted) {
          // 音频下载占 42%-70%
          const adjusted = 42 + (percent / 100) * 28;
          sendEvent({
            type: "progress",
            percent: Math.round(adjusted),
            stage: "downloading-audio",
          });
        }
      });

      if (aborted) return res.end();

      // 合并视频和音频
      sendEvent({
        type: "progress",
        percent: 72,
        stage: "merging",
        status: "正在合并视频和音频...",
      });

      const mp4Path = join(TMP_DIR, `${jobId}.mp4`);
      const ffmpeg = spawn("ffmpeg", [
        "-i",
        videoRaw,
        "-i",
        audioRaw,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-strict",
        "experimental",
        "-y",
        mp4Path,
      ]);
      activeProcesses.set(jobId, ffmpeg);

      await new Promise((resolve, reject) => {
        ffmpeg.stderr.on("data", (data) => {
          const text = data.toString();
          const timeMatch = text.match(
            /time=(\d{2}):(\d{2}):(\d{2})\.(\d+)/
          );
          if (timeMatch && info.duration > 0) {
            const h = parseInt(timeMatch[1]);
            const m = parseInt(timeMatch[2]);
            const s = parseInt(timeMatch[3]);
            const ms = parseInt(timeMatch[4]) / 100;
            const current = h * 3600 + m * 60 + s + ms;
            const percent = Math.min((current / info.duration) * 100, 99);
            // 合并占 72%-98%
            const adjusted = 72 + (percent / 100) * 26;
            if (!aborted)
              sendEvent({
                type: "progress",
                percent: Math.round(adjusted),
                stage: "merging",
              });
          }
        });

        ffmpeg.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`合并失败 (code: ${code})`));
        });

        ffmpeg.on("error", (err) => reject(err));
      });

      if (aborted) return res.end();

      // 清理临时文件
      try {
        unlinkSync(videoRaw);
        unlinkSync(audioRaw);
      } catch (e) {}

      downloadJobs.set(jobId, {
        filePath: mp4Path,
        fileName: `${jobId}.mp4`,
        ext: ".mp4",
        createdAt: Date.now(),
      });

      sendEvent({
        type: "complete",
        jobId,
        fileId: jobId,
        fileName: `${jobId}.mp4`,
      });
      activeProcesses.delete(jobId);
    }
  } catch (error) {
    console.error("下载失败:", error.message);
    cleanupTemp();
    activeProcesses.delete(jobId);
    let msg = error.message || "下载失败";
    if (msg.includes("Command failed") || msg.includes("curl")) {
      msg = "下载流失败，可能是网络超时或视频需要登录";
    }
    sendEvent({ type: "error", error: msg });
  }

  res.end();
});

// 获取下载的文件
app.get("/api/file/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = downloadJobs.get(jobId);

  if (!job || !existsSync(job.filePath)) {
    return res.status(404).json({ error: "文件不存在或已过期" });
  }

  const mimeTypes = {
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".webm": "video/webm",
  };

  const contentType = mimeTypes[job.ext] || "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(job.fileName)}"`
  );

  res.sendFile(job.filePath, (err) => {
    if (!err) {
      setTimeout(() => {
        try {
          if (existsSync(job.filePath)) {
            unlinkSync(job.filePath);
          }
          downloadJobs.delete(jobId);
        } catch (e) {}
      }, 30000);
    }
  });
});

// 图片代理（解决浏览器无法直接访问B站CDN的问题）
app.get("/api/proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url");

  try {
    const { stdout } = await execAsync(
      `curl -s --max-time 10 "${url}" -H "Referer: https://www.bilibili.com/"`,
      { maxBuffer: 10 * 1024 * 1024, encoding: "buffer" }
    );
    const ext = url.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1]?.toLowerCase() || "jpg";
    const mimeMap = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      webp: "image/webp", gif: "image/gif",
    };
    res.setHeader("Content-Type", mimeMap[ext] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(stdout);
  } catch (e) {
    res.status(500).send("Proxy error");
  }
});

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "2.0.0", engine: "bilibili-api" });
});

app.listen(PORT, () => {
  console.log(`✅ B站下载工具服务已启动`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
  console.log(`📦 引擎: B站API直连 + ffmpeg`);
});
