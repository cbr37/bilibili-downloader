# B站视频/番剧下载工具

一键下载B站视频的音频(MP3)、视频(MP4)或番剧剧集，只需粘贴链接即可。

## 功能

- 解析B站视频信息（标题、UP主、时长、画质）
- **番剧/影视支持**：自动识别 ep/ss 链接，显示完整剧集列表，可自由选集下载
- **免登录下载**：配置默认 Cookie 后，用户无需登录即可下载 1080P
- **大会员支持**：用户填入自己的 SESSDATA Cookie 可下载会员专享剧集及 4K 高画质
- **画质选择器**：解析后显示可用画质列表，可自由切换画质
- 下载音频为 MP3 格式
- 下载视频为 MP4 格式（H.264 + AAC）
- 文件名自动使用「番剧名 - 剧集标题」格式
- 实时下载进度显示（SSE 流式推送）
- 支持普通链接、番剧链接和短链(b23.tv)

## 免登录 1080P 配置（服务器管理员）

B站 API 限制：完全匿名访问只能 360P，但用一个**普通账号**（非会员即可）的 Cookie 就能解锁 1080P。

### 方法一：环境变量

```bash
# 本地运行
BILI_SESSDATA=你的SESSDATA值 node server.js

# Docker 运行
docker run -d -p 3000:3000 -e BILI_SESSDATA=你的SESSDATA值 bili-dl
```

### 方法二：Docker Compose

```yaml
services:
  bili-dl:
    build: .
    ports:
      - "3000:3000"
    environment:
      - BILI_SESSDATA=你的SESSDATA值
    restart: unless-stopped
```

### 获取 SESSDATA

1. 在浏览器登录B站（普通账号即可，不需要大会员）
2. 按 F12 → Application → Cookies → `https://www.bilibili.com`
3. 复制 `SESSDATA` 的值

> 配置后，所有用户无需手动填写 Cookie 即可下载 1080P 视频。

## 支持的链接格式

| 类型 | 示例 |
|------|------|
| 普通视频 | `https://www.bilibili.com/video/BV1xxx` |
| 番剧（单集） | `https://www.bilibili.com/bangumi/play/ep259699` |
| 番剧（全集） | `https://www.bilibili.com/bangumi/play/ss26169` |
| 短链 | `https://b23.tv/xxxxx` |

## 画质说明

| 状态 | 可用画质 |
|------|---------|
| 未配置默认 Cookie + 用户未填 Cookie | 360P/480P |
| 配置了默认 Cookie + 用户未填 Cookie | 480P ~ 1080P |
| 用户填写自己的 Cookie | 最高可达 8K（取决于账号权限） |
| 大会员账号 Cookie | 4K / HDR / 杜比视界 |

## 本地运行

```bash
npm install
node server.js
```

访问 http://localhost:3000

## Docker 部署

```bash
docker build -t bili-dl .
docker run -d -p 3000:3000 -e BILI_SESSDATA=你的SESSDATA值 --restart unless-stopped bili-dl
```

## 技术栈

- 后端：Node.js + Express
- 前端：原生 HTML/CSS/JS
- 下载：curl + ffmpeg
- API：B站官方接口直连

## 依赖

- Node.js 18+
- ffmpeg（用于音频转码和视频合并）
- curl（用于下载流文件）

## 声明

本工具仅供个人学习使用，请遵守B站用户协议及版权法规。
