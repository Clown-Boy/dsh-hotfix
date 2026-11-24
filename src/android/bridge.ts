import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'

export interface AndroidStatus {
  apkVersionName: string
  apkVersionCode: number
  webVersion: string
  hasActiveHotUpdate: boolean
  githubRepo: string
  isRepoConfigured: boolean
  mirrorBaseUrl: string
  autoCheckOnStart: boolean
  autoApplyHotUpdate: boolean
}

export type AndroidUpdateEvent =
  | { type: 'checking' }
  | { type: 'unconfigured' }
  | { type: 'up_to_date'; webVersion: string }
  | {
      type: 'hot_available'
      webVersion: string
      currentWebVersion: string
      fileCount: number
      reuseCount: number
      downloadBytes: number
      releaseNotes: string
      hasApk: boolean
    }
  | {
      type: 'apk_available'
      versionName: string
      versionCode: number
      size: number
      required: boolean
      releaseNotes: string
    }
  | { type: 'hot_progress'; done: number; total: number; file: string }
  | { type: 'hot_done'; webVersion: string }
  | { type: 'apk_progress'; done: number; total: number }
  | { type: 'apk_ready'; versionName: string }
  | { type: 'error'; message: string }

interface AndroidAppBridgeNative {
  getStatusJson: () => string
  saveUpdateConfig: (
    githubRepo: string,
    mirrorBaseUrl: string,
    autoCheckOnStart: boolean,
    autoApplyHotUpdate: boolean
  ) => string
  checkUpdate: () => void
  applyHotUpdate: () => void
  downloadAndInstallApk: () => void
  reloadApp: () => void
  saveBase64File: (filename: string, mimeType: string, base64Data: string) => void
  syncSystemBars: (cssColor: string, isDark: boolean) => void
}

declare global {
  interface Window {
    AndroidAppBridge?: AndroidAppBridgeNative
    __onAndroidUpdateEvent?: (event: AndroidUpdateEvent) => void
    __onAndroidBackPress?: () => boolean
  }
}

export const isAndroidApp = (): boolean => Boolean(window.AndroidAppBridge)

export const getAndroidStatus = (): AndroidStatus | null => {
  const bridge = window.AndroidAppBridge
  if (!bridge) {
    return null
  }
  try {
    return JSON.parse(bridge.getStatusJson()) as AndroidStatus
  } catch {
    return null
  }
}

export const saveAndroidConfig = (params: {
  githubRepo: string
  mirrorBaseUrl: string
  autoCheckOnStart: boolean
  autoApplyHotUpdate: boolean
}): AndroidStatus | null => {
  const bridge = window.AndroidAppBridge
  if (!bridge) {
    return null
  }
  try {
    const json = bridge.saveUpdateConfig(
      params.githubRepo,
      params.mirrorBaseUrl,
      params.autoCheckOnStart,
      params.autoApplyHotUpdate
    )
    return JSON.parse(json) as AndroidStatus
  } catch {
    return null
  }
}

export const triggerCheckUpdate = () => {
  window.AndroidAppBridge?.checkUpdate()
}

export const triggerHotUpdate = () => {
  window.AndroidAppBridge?.applyHotUpdate()
}

export const triggerApkUpdate = () => {
  window.AndroidAppBridge?.downloadAndInstallApk()
}

export const reloadAndroidApp = () => {
  window.AndroidAppBridge?.reloadApp()
}

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    chunks.push(String.fromCharCode(...slice))
  }
  return btoa(chunks.join(''))
}

let hooksInstalled = false

/**
 * 仅在 Android WebView 容器内启用：
 * 1. 拦截 blob: 下载链接（ZIP 会话导出 / 附件下载），转交原生写入系统下载目录；
 * 2. 监听系统返回键，优先关闭当前弹层或弹窗。
 */
export const setupAndroidWebHooks = () => {
  if (hooksInstalled || !isAndroidApp()) {
    return
  }
  hooksInstalled = true

  const originalClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function patchedClick(this: HTMLAnchorElement) {
    const bridge = window.AndroidAppBridge
    const href = this.getAttribute('href') || this.href
    const downloadName = this.getAttribute('download')
    if (bridge && downloadName && href && href.startsWith('blob:')) {
      void (async () => {
        try {
          const response = await fetch(href)
          const blob = await response.blob()
          const buffer = await blob.arrayBuffer()
          const base64 = arrayBufferToBase64(buffer)
          bridge.saveBase64File(downloadName, blob.type || 'application/octet-stream', base64)
        } catch {
          originalClick.call(this)
        }
      })()
      return
    }
    originalClick.call(this)
  }

  window.__onAndroidBackPress = () => {
    const overlays = document.querySelectorAll('[role="listbox"], [role="menu"], [role="dialog"]')
    if (overlays.length > 0) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
    }
    if (useSearchPanel.getState().entry !== null) {
      closeSearchPanel()
      return true
    }
    if (useMobileSider.getState().open) {
      closeMobileSider()
      return true
    }
    return false
  }

  const pushSystemBarTheme = () => {
    const bridge = window.AndroidAppBridge
    if (!bridge || !document.body) {
      return
    }
    const isDark = document.body.classList.contains('dark')
    const bgColor = getComputedStyle(document.body).backgroundColor
    bridge.syncSystemBars(bgColor, isDark)
  }

  const startThemeObserver = () => {
    pushSystemBarTheme()
    if (!document.body) {
      return
    }
    const observer = new MutationObserver(() => {
      pushSystemBarTheme()
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  }

  if (document.readyState === 'complete') {
    startThemeObserver()
  } else {
    window.addEventListener('load', startThemeObserver, { once: true })
  }
}
