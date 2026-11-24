import { useEffect, useState } from 'react'
import { Button } from '../components/base/Button.js'
import {
  getAndroidStatus,
  isAndroidApp,
  reloadAndroidApp,
  saveAndroidConfig,
  triggerApkUpdate,
  triggerCheckUpdate,
  triggerHotUpdate,
  type AndroidStatus,
  type AndroidUpdateEvent,
} from './bridge.js'
import styles from './AndroidUpdateSection.module.css'

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Android 客户端专属更新面板：支持手动/自动检查、单文件增量热更新、APK 整包更新及 GitHub 仓库/镜像配置。
 * 在普通浏览器环境中自动隐藏。
 */
export const AndroidUpdateSection = () => {
  const [status, setStatus] = useState<AndroidStatus | null>(() => getAndroidStatus())
  const [event, setEvent] = useState<AndroidUpdateEvent | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [repoInput, setRepoInput] = useState(() => status?.githubRepo ?? 'Clown-Boy/dsh-hotfix')
  const [mirrorInput, setMirrorInput] = useState(() => status?.mirrorBaseUrl ?? '')
  const [autoCheck, setAutoCheck] = useState(() => status?.autoCheckOnStart ?? true)
  const [autoHot, setAutoHot] = useState(() => status?.autoApplyHotUpdate ?? false)
  const [savedNotice, setSavedNotice] = useState('')

  useEffect(() => {
    if (!isAndroidApp()) {
      return
    }
    const previous = window.__onAndroidUpdateEvent
    window.__onAndroidUpdateEvent = (next) => {
      setEvent(next)
      if (next.type === 'hot_done') {
        setStatus(getAndroidStatus())
      }
      previous?.(next)
    }
    return () => {
      window.__onAndroidUpdateEvent = previous
    }
  }, [])

  if (!isAndroidApp() || !status) {
    return null
  }

  const busy =
    event?.type === 'checking' || event?.type === 'hot_progress' || event?.type === 'apk_progress'

  const handleSaveConfig = () => {
    const updated = saveAndroidConfig({
      githubRepo: repoInput,
      mirrorBaseUrl: mirrorInput,
      autoCheckOnStart: autoCheck,
      autoApplyHotUpdate: autoHot,
    })
    if (updated) {
      setStatus(updated)
      setSavedNotice('更新配置已保存')
    }
  }

  const handleToggleAutoCheck = (checked: boolean) => {
    setAutoCheck(checked)
    const updated = saveAndroidConfig({
      githubRepo: repoInput,
      mirrorBaseUrl: mirrorInput,
      autoCheckOnStart: checked,
      autoApplyHotUpdate: autoHot,
    })
    if (updated) {
      setStatus(updated)
    }
  }

  const handleToggleAutoHot = (checked: boolean) => {
    setAutoHot(checked)
    const updated = saveAndroidConfig({
      githubRepo: repoInput,
      mirrorBaseUrl: mirrorInput,
      autoCheckOnStart: autoCheck,
      autoApplyHotUpdate: checked,
    })
    if (updated) {
      setStatus(updated)
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.headerRow}>
        <div className={styles.titleGroup}>
          <div className={styles.title}>应用与热更新</div>
          <div className={styles.meta}>
            客户端 v{status.apkVersionName}（Build {status.apkVersionCode}） · 前端资源{' '}
            {status.webVersion}
            {status.hasActiveHotUpdate ? '（已启用增量热更新）' : '（内置基线）'}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <Button variant="outlined" size="m" disabled={busy} onClick={triggerCheckUpdate}>
          {event?.type === 'checking' ? '检查中...' : '检查更新'}
        </Button>
        <Button
          variant="outlined"
          size="m"
          onClick={() => {
            setSavedNotice('')
            setShowConfig((prev) => !prev)
          }}
        >
          {showConfig ? '收起更新源设置' : '更新源设置'}
        </Button>
      </div>

      {event ? (
        <div className={styles.statusBox}>
          {event.type === 'checking' ? '正在从 GitHub Releases 获取最新清单...' : null}
          {event.type === 'unconfigured'
            ? '尚未配置有效的 GitHub 仓库（当前为 OWNER/REPO）。请点击「更新源设置」填入你的 用户名/仓库名。'
            : null}
          {event.type === 'up_to_date'
            ? `当前已是最新版本（${event.webVersion}）。`
            : null}
          {event.type === 'hot_available' ? (
            <div>
              <div>
                发现前端新版本 {event.webVersion}：共需增量下载 {event.fileCount} 个文件（
                {formatBytes(event.downloadBytes)}），复用 {event.reuseCount} 个未变动文件。
              </div>
              {event.releaseNotes ? <div>{event.releaseNotes}</div> : null}
              <div className={styles.actions} style={{ marginTop: 8 }}>
                <Button variant="primary" size="s" onClick={triggerHotUpdate}>
                  立即增量热更新
                </Button>
                {event.hasApk ? (
                  <Button variant="outlined" size="s" onClick={triggerApkUpdate}>
                    下载完整 APK
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {event.type === 'hot_progress'
            ? `正在增量更新文件 (${event.done}/${event.total})：${event.file}`
            : null}
          {event.type === 'hot_done' ? (
            <div>
              <div>增量热更新已完成（{event.webVersion}），刷新页面即可生效。</div>
              <div className={styles.actions} style={{ marginTop: 8 }}>
                <Button variant="primary" size="s" onClick={reloadAndroidApp}>
                  立即刷新页面
                </Button>
              </div>
            </div>
          ) : null}
          {event.type === 'apk_available' ? (
            <div>
              <div>
                发现新版本 APK：{event.versionName}（{formatBytes(event.size)}）
              </div>
              {event.releaseNotes ? <div>{event.releaseNotes}</div> : null}
              <div className={styles.actions} style={{ marginTop: 8 }}>
                <Button variant="primary" size="s" onClick={triggerApkUpdate}>
                  下载并安装 APK
                </Button>
              </div>
            </div>
          ) : null}
          {event.type === 'apk_progress'
            ? `正在下载 APK：${formatBytes(event.done)}${
                event.total > 0 ? ` / ${formatBytes(event.total)}` : ''
              }`
            : null}
          {event.type === 'apk_ready' ? `APK ${event.versionName} 下载完成，正在调起安装...` : null}
          {event.type === 'error' ? (
            <span className={styles.statusError}>更新失败：{event.message}</span>
          ) : null}
        </div>
      ) : null}

      <label className={styles.toggleRow}>
        <span>启动时自动检查更新</span>
        <input
          type="checkbox"
          checked={autoCheck}
          onChange={(e) => handleToggleAutoCheck(e.target.checked)}
        />
      </label>

      <label className={styles.toggleRow}>
        <span>自动静默应用前端单文件热更新</span>
        <input
          type="checkbox"
          checked={autoHot}
          onChange={(e) => handleToggleAutoHot(e.target.checked)}
        />
      </label>

      {showConfig ? (
        <div className={styles.configGroup}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="android-github-repo">
              GitHub 更新仓库（格式：用户名/仓库名）
            </label>
            <input
              id="android-github-repo"
              className={styles.input}
              value={repoInput}
              placeholder="例如：zhangsan/DeepSeekApkDemo"
              onChange={(e) => setRepoInput(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="android-mirror-url">
              可选 GitHub 加速镜像前缀（留空则直连 GitHub）
            </label>
            <input
              id="android-mirror-url"
              className={styles.input}
              value={mirrorInput}
              placeholder="例如：https://ghfast.top/"
              onChange={(e) => setMirrorInput(e.target.value)}
            />
          </div>
          <div className={styles.actions}>
            <Button variant="outlined" size="s" onClick={handleSaveConfig}>
              保存更新源设置
            </Button>
            {savedNotice ? <span className={styles.meta}>{savedNotice}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
