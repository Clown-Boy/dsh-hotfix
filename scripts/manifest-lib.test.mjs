import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildUpdateManifest, diffManifestFiles, toReleaseAssetName } from './manifest-lib.mjs'

test('toReleaseAssetName flattens nested relative paths safely', () => {
  assert.equal(toReleaseAssetName('index.html'), 'index.html')
  assert.equal(
    toReleaseAssetName('static/js/async/chunk.1234abcd.js'),
    'static__js__async__chunk.1234abcd.js'
  )
  assert.equal(
    toReleaseAssetName('\\static\\css\\main.abcd1234.css'),
    'static__css__main.abcd1234.css'
  )
})

test('diffManifestFiles downloads only changed or added files and reuses unchanged ones', () => {
  const localDir = mkdtempSync(path.join(os.tmpdir(), 'ds-manifest-local-'))
  const remoteDir = mkdtempSync(path.join(os.tmpdir(), 'ds-manifest-remote-'))
  try {
    mkdirSync(path.join(localDir, 'static', 'js'), { recursive: true })
    mkdirSync(path.join(remoteDir, 'static', 'js'), { recursive: true })

    writeFileSync(path.join(localDir, 'index.html'), '<html>v1</html>')
    writeFileSync(path.join(localDir, 'static', 'js', 'vendor.1111.js'), 'vendor-code')
    writeFileSync(path.join(localDir, 'static', 'js', 'app.aaaa.js'), 'app-v1')
    writeFileSync(path.join(localDir, 'static', 'js', 'old.0000.js'), 'removed')

    writeFileSync(path.join(remoteDir, 'index.html'), '<html>v2</html>')
    writeFileSync(path.join(remoteDir, 'static', 'js', 'vendor.1111.js'), 'vendor-code')
    writeFileSync(path.join(remoteDir, 'static', 'js', 'app.bbbb.js'), 'app-v2')

    const localManifest = buildUpdateManifest({ distDir: localDir, webVersion: '1.0.0' })
    const remoteManifest = buildUpdateManifest({ distDir: remoteDir, webVersion: '1.0.1' })

    const diff = diffManifestFiles(localManifest.files, remoteManifest.files)
    assert.deepEqual(
      diff.reuse.map((f) => f.path),
      ['static/js/vendor.1111.js']
    )
    assert.deepEqual(
      diff.download.map((f) => f.path),
      ['index.html', 'static/js/app.bbbb.js']
    )
    assert.deepEqual(
      diff.remove.map((f) => f.path),
      ['static/js/app.aaaa.js', 'static/js/old.0000.js']
    )
  } finally {
    rmSync(localDir, { recursive: true, force: true })
    rmSync(remoteDir, { recursive: true, force: true })
  }
})
