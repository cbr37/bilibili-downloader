# B站视频/番剧下载工具

一键下载B站视频的音频(MP3)、视频(MP4)或番剧剧集，只需粘贴链接即可。

## 功能

- 解析B站视频信息（标题、UP主、时长、画质）
- **番剧/影视支持**：自动识别 ep/ss 链接，显示完整剧集列表，可自由选集下载
- **大会员支持**：填入 SESSDATA Cookie 后可下载会员专享剧集及 1080P/4K 高画质
- **画质选择器**：解析后显示可用画质列表，可自由切换画质
- 下载音频为 MP3 格式
- 下载视频为 MP4 格式（H.264 + AAC）
- 文件名自动使用「番剧名 - 剧集标题」格式
- 实时下载进度显示（SSE 流式推送）
- 支持普通链接、番剧链接和短链(b23.tv)

## 支持的链接格式

| 类型 | 示例 |
|------|------|
| 普通视频 | `https://www.bilibili.com/video/BV1xxx` |
| 番剧（单集） | `https://www.bilibili.com/bangumi/play/ep259699` |
| 番剧（全集） | `https://www.bilibili.com/bangumi/play/ss26169` |
| 短链 | `https://b23.tv/xxxxx` |

## 如何使用大会员功能

1. 在浏览器登录B站（确保是大会员账号）
2. 按 F12 打开开发者工具 → Application → Cookies → `https://www.bilibili.com`
3. 找到 `SESSDATA` 字段，复制其值
4. 在本工具页面点击「大会员登录（可选）」，粘贴 SESSDATA 值
5. 粘贴番剧链接并解析，即可看到会员专享剧集和高画质选项

> Cookie 仅用于本次下载请求，不会存储在服务器上。

## 技术栈

- 后端：Node.js + Express
- 前端：原生 HTML/CSS/JS
- 下载：curl + ffmpeg
- API：B站官方接口直连
  - 视频信息：`/x/web-interface/view`
  - 番剧信息：`/pgc/view/web/season`
  - 播放地址：`/x/player/playurl`、`/pgc/player/web/playurl`

## 本地运行

```bash
npm install
node server.js
```

访问 http://localhost:3000

## Docker 部署

```bash
docker build -t bili-dl .
docker run -d -p 3000:3000 --restart unless-stopped bili-dl
```

## 依赖

- Node.js 18+
- ffmpeg（用于音频转码和视频合并）
- curl（用于下载流文件）

## 已知限制

- 未登录状态下，画质最高 480P（B站限制）
- 大会员专享内容需填入有效 SESSDATA Cookie
- 海外服务器部署时，B站 CDN 可能拒绝访问（需中国大陆 IP）

## 声明

本工具仅供个人学习使用，请遵守B站用户协议及版权法规。
