import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const MANIFEST_FILENAME = 'update-manifest.json'

/**
 * 将相对路径转换为 GitHub Releases 合法的扁平附件名。
 * 例如 `static/js/app.1234abcd.js` -> `static__js__app.1234abcd.js`
 */
export function toReleaseAssetName(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return normalized.replace(/\//g, '__')
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath))
}

/**
 * 递归收集目录中的所有文件（排除 update-manifest.json 本身）
 */
export function collectDistFiles(distDir, currentDir = distDir) {
  const entries = readdirSync(currentDir, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectDistFiles(distDir, fullPath))
    } else if (entry.isFile()) {
      const relPath = path.relative(distDir, fullPath).replace(/\\/g, '/')
      if (relPath === MANIFEST_FILENAME) {
        continue
      }
      const stat = statSync(fullPath)
      results.push({
        path: relPath,
        assetName: toReleaseAssetName(relPath),
        sha256: sha256File(fullPath),
        size: stat.size,
      })
    }
  }
  results.sort((a, b) => a.path.localeCompare(b.path))
  return results
}

/**
 * 生成供 Android 客户端和 GitHub Releases 使用的 update-manifest.json 对象
 */
export function buildUpdateManifest({
  distDir,
  webVersion,
  minApkVersionCode = 1,
  releaseNotes = '',
  apk = null,
  publishedAt = new Date().toISOString(),
}) {
  const files = collectDistFiles(distDir)
  return {
    schemaVersion: 1,
    webVersion,
    minApkVersionCode,
    publishedAt,
    releaseNotes,
    apk,
    files,
  }
}

/**
 * 比对本地与远端文件列表，计算需要复用、下载和删除的文件
 */
export function diffManifestFiles(localFiles, remoteFiles) {
  const localByPath = new Map(localFiles.map((f) => [f.path, f]))
  const remotePathSet = new Set(remoteFiles.map((f) => f.path))
  const reuse = []
  const download = []
  const remove = []

  for (const remote of remoteFiles) {
    const local = localByPath.get(remote.path)
    if (local && local.sha256 === remote.sha256 && local.size === remote.size) {
      reuse.push(remote)
    } else {
      download.push(remote)
    }
  }

  for (const local of localFiles) {
    if (!remotePathSet.has(local.path)) {
      remove.push(local)
    }
  }

  return { reuse, download, remove }
}
