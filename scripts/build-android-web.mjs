import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildUpdateManifest, MANIFEST_FILENAME } from './manifest-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const androidAssetsDir = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const rspackEntry = path.join(root, 'node_modules', '@rspack', 'cli', 'bin', 'rspack.js')

rmSync(distDir, { recursive: true, force: true })

const result = spawnSync(process.execPath, [rspackEntry, 'build', '-c', 'rspack.android.config.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
  },
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const webVersion = process.env.WEB_VERSION || `${pkg.version}+local`
const minApkVersionCode = Number.parseInt(process.env.MIN_APK_VERSION_CODE || '1', 10) || 1
const releaseNotes = process.env.RELEASE_NOTES || ''

const manifest = buildUpdateManifest({
  distDir,
  webVersion,
  minApkVersionCode,
  releaseNotes,
  apk: null,
})

writeFileSync(path.join(distDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

rmSync(androidAssetsDir, { recursive: true, force: true })
mkdirSync(androidAssetsDir, { recursive: true })
cpSync(distDir, androidAssetsDir, { recursive: true })

process.stdout.write(
  `[build-android-web] Built ${manifest.files.length} files (webVersion=${webVersion}) and synced to android/app/src/main/assets/www\n`
)
