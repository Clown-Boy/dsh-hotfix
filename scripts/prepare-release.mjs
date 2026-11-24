import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildUpdateManifest, MANIFEST_FILENAME, sha256File } from './manifest-lib.mjs'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key.startsWith('--')) {
      const name = key.slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
      args[name] = val
    }
  }
  return args
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const outDir = path.join(root, 'release-assets')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const args = parseArgs(process.argv.slice(2))

const webVersion = args['web-version'] || process.env.WEB_VERSION || pkg.version
const minApkVersionCode = Number.parseInt(args['min-apk-version-code'] || '1', 10) || 1
const releaseNotes = args['notes'] || ''
const apkPath = args['apk'] ? path.resolve(root, args['apk']) : null
const apkVersionCode = Number.parseInt(args['apk-version-code'] || '1', 10) || 1
const apkVersionName = args['apk-version-name'] || pkg.version

let apkMeta = null
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

if (apkPath) {
  const apkAssetName = args['apk-asset-name'] || path.basename(apkPath)
  const destApk = path.join(outDir, apkAssetName)
  copyFileSync(apkPath, destApk)
  apkMeta = {
    versionCode: apkVersionCode,
    versionName: apkVersionName,
    assetName: apkAssetName,
    sha256: sha256File(destApk),
    size: statSync(destApk).size,
  }
}

const manifest = buildUpdateManifest({
  distDir,
  webVersion,
  minApkVersionCode,
  releaseNotes,
  apk: apkMeta,
})

for (const file of manifest.files) {
  copyFileSync(path.join(distDir, file.path), path.join(outDir, file.assetName))
}

const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
writeFileSync(path.join(outDir, MANIFEST_FILENAME), manifestJson, 'utf8')
writeFileSync(path.join(distDir, MANIFEST_FILENAME), manifestJson, 'utf8')

process.stdout.write(
  `[prepare-release] Prepared ${manifest.files.length} flat web assets${apkMeta ? ` + ${apkMeta.assetName}` : ''} in release-assets/\n`
)
