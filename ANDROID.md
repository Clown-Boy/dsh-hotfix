# DeepSeek Chat Android 客户端说明

本项目基于开源仓库 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 封装为独立 **Android APK**，并支持通过 **GitHub Releases** 进行**单文件增量热更新**与**APK 整包更新**。

## 核心特性

- **固定 Origin 不丢数据**：原生层使用 `WebViewAssetLoader` 虚拟域名 `https://appassets.androidplatform.net/` 加载页面，热更新或覆盖安装 APK 后，`localStorage` 中的 API Key 与 `IndexedDB` 中的对话记录完整保留。
- **单文件 / 增量热更新**：
  - 每次构建生成 `update-manifest.json`，记录每个前端产物的路径、扁平附件名（`assetName`）与 SHA-256 哈希。
  - 手机端对比本地与远端清单后，**仅下载发生变化的单个或多个文件**，其余未变文件直接本地复用。
  - 所有文件下载并完成 SHA-256 校验后原子切换生效，失败自动保留旧版不白屏。
- **手动 & 自动更新**：支持启动自动检查（可开关“自动静默热更新”）、设置页手动检查更新，以及可选 GitHub 加速镜像前缀。
- **移动端能力适配**：支持麦克风语音输入、附件选择器、ZIP 聊天记录导出到系统 `Downloads` 目录、系统返回键拦截及安全区适配。

## 上游更新同步与发布流程

### 1. 绑定你自己的 GitHub 仓库
```bash
git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
```
同时修改 [android/gradle.properties](android/gradle.properties) 中的 `DEEPSEEK_GITHUB_REPO`（或在手机 App「设置 -> 更新源设置」中直接填写）。

### 2. 同步上游 `deepseek-ai/chat-demo` 的文件更新
```bash
git fetch upstream
git merge upstream/main
```
由于 Android 桥接与热更新 UI 均独立放置在 `src/android/` 与 `android/`，合并上游单文件改动几乎无冲突。

### 3. 本地构建前端与 Debug APK
```bash
pnpm build:android
cd android
./gradlew assembleDebug
```
生成的 APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

### 4. 自动发布更新到 GitHub Releases
- **完整发布（前端 + APK）**：推送 Tag（如 `git tag v0.1.4 && git push origin v0.1.4`），或到 GitHub Actions 页面手动触发 `Android Release & Hot Update` 选择 `full`。
- **仅发布单文件前端热更新（约 30 秒完成）**：到 GitHub Actions 页面手动触发 `Android Release & Hot Update`，`release_type` 选择 `hotfix`，手机端即可增量拉取变动单文件完成更新。
