# B站视频音频下载工具

一键下载B站视频的音频(MP3)或视频(MP4)，只需粘贴视频链接即可。

## 功能

- 解析B站视频信息（标题、UP主、时长、画质）
- 下载音频为 MP3 格式
- 下载视频为 MP4 格式（H.264 + AAC）
- 实时下载进度显示
- 支持普通链接和短链(b23.tv)

## 技术栈

- 后端：Node.js + Express
- 前端：原生 HTML/CSS/JS
- 下载：curl + ffmpeg
- API：B站官方接口直连

## 本地运行

```bash
npm install
node server.js
```

访问 http://localhost:3000

## 依赖

- Node.js 18+
- ffmpeg（用于音频转码和视频合并）
- curl（用于下载流文件）

## 声明

本工具仅供个人学习使用，请遵守B站用户协议及版权法规。
