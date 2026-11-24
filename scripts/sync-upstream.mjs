import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const gradlePropsPath = path.join(root, 'android', 'gradle.properties')

function parseArgs(argv) {
  const args = { mode: 'hotfix', force: false, dryRun: false, tag: '' }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--mode' && argv[i + 1]) {
      args.mode = argv[++i]
    } else if (token === '--tag' && argv[i + 1]) {
      args.tag = argv[++i]
    } else if (token === '--force') {
      args.force = true
    } else if (token === '--dry-run') {
      args.dryRun = true
    }
  }
  return args
}

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options.spawnOptions,
  })
  if (result.status !== 0 && !options.allowFail) {
    const errText = options.capture ? result.stderr || result.stdout : ''
    throw new Error(`命令执行失败: ${cmd} ${cmdArgs.join(' ')}\n${errText}`.trim())
  }
  return result
}

function runPnpm(pnpmArgs) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec || 'cmd.exe', ['/c', 'pnpm', ...pnpmArgs])
  }
  return run('pnpm', pnpmArgs)
}

function formatTimestampTag() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function readOriginRepoSlug() {
  const res = run('git', ['remote', 'get-url', 'origin'], { capture: true, allowFail: true })
  const url = (res.stdout || '').trim()
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)
  return match ? match[1] : null
}

function bumpGradleVersionCode() {
  const raw = readFileSync(gradlePropsPath, 'utf8')
  const match = raw.match(/^DEEPSEEK_APP_VERSION_CODE=(\d+)/m)
  const currentCode = match ? Number.parseInt(match[1], 10) : 1
  const nextCode = currentCode + 1
  const updated = match
    ? raw.replace(/^DEEPSEEK_APP_VERSION_CODE=\d+/m, `DEEPSEEK_APP_VERSION_CODE=${nextCode}`)
    : `${raw.trimEnd()}\nDEEPSEEK_APP_VERSION_CODE=${nextCode}\n`
  writeFileSync(gradlePropsPath, updated, 'utf8')
  return nextCode
}

const args = parseArgs(process.argv.slice(2))
if (args.mode !== 'hotfix' && args.mode !== 'full') {
  console.error(`[sync] 不支持的模式: ${args.mode}（仅支持 hotfix 或 full）`)
  process.exit(1)
}

console.log(`\n=== [1/6] 检查本地工作区状态 (模式: ${args.mode}) ===`)
const dirty = run('git', ['status', '--porcelain'], { capture: true }).stdout.trim()
if (dirty) {
  console.error('[sync] 检测到本地存在未提交的修改，请先提交或暂存后再运行一键同步：\n' + dirty)
  process.exit(1)
}

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).stdout.trim()
if (branch !== 'main') {
  console.error(`[sync] 当前分支为 "${branch}"，请先切换到 main 分支后再执行。`)
  process.exit(1)
}

console.log('=== [2/6] 拉取上游 deepseek-ai/chat-demo 最新提交 ===')
run('git', ['fetch', 'upstream'])
const upstreamCount = Number.parseInt(
  run('git', ['rev-list', '--count', 'HEAD..upstream/main'], { capture: true }).stdout.trim() || '0',
  10
)

let aheadOfOrigin = 0
const hasOriginMain =
  run('git', ['rev-parse', '--verify', 'origin/main'], { capture: true, allowFail: true }).status === 0
if (hasOriginMain) {
  aheadOfOrigin = Number.parseInt(
    run('git', ['rev-list', '--count', 'origin/main..HEAD'], { capture: true }).stdout.trim() || '0',
    10
  )
}

if (upstreamCount > 0) {
  console.log(`\n发现上游有 ${upstreamCount} 个新提交：`)
  run('git', ['log', '--oneline', 'HEAD..upstream/main'])
  console.log('\n=== [3/6] 合并上游代码 ===')
  const mergeRes = run('git', ['merge', 'upstream/main', '--no-edit'], { allowFail: true })
  if (mergeRes.status !== 0) {
    const conflicts = run('git', ['diff', '--name-only', '--diff-filter=U'], { capture: true }).stdout.trim()
    console.error('\n[sync] 合并上游时发生冲突，已停止推送！冲突文件如下：')
    console.error(conflicts || '(请运行 git status 查看)')
    console.error('\n请手动解决冲突后执行 git commit，再运行本脚本加上 --force 发布。')
    process.exit(1)
  }
} else {
  console.log('上游 deepseek-ai/chat-demo 暂无新提交。')
  if (aheadOfOrigin === 0 && !args.force) {
    console.log('本地与远程均已是最新状态，无需重复发布。（如需强制重新打包发布，请加 --force 参数）')
    process.exit(0)
  }
}

console.log('\n=== [4/6] 安装依赖并运行类型/规范/构建自检 ===')
runPnpm(['install'])
runPnpm(['type'])
runPnpm(['lint'])
runPnpm(['test:manifest'])
runPnpm(['build:android'])

let releaseTag = args.tag
if (args.mode === 'hotfix') {
  if (!releaseTag) {
    releaseTag = `hotfix-${formatTimestampTag()}`
  }
} else {
  const nextCode = bumpGradleVersionCode()
  run('git', ['add', 'android/gradle.properties'])
  run('git', ['commit', '-m', `chore: bump android versionCode to ${nextCode}`])
  if (!releaseTag) {
    releaseTag = `v${pkg.version}-b${nextCode}`
  }
}

console.log(`\n=== [5/6] 推送代码与发布标签 (${releaseTag}) ===`)
if (args.dryRun) {
  console.log(`[dry-run] 跳过 git push，预计推送分支 main 与标签 ${releaseTag}`)
  process.exit(0)
}

run('git', ['push', 'origin', 'main'])
run('git', ['tag', releaseTag])
run('git', ['push', 'origin', releaseTag])

const repoSlug = readOriginRepoSlug()
console.log('\n=== [6/6] 完成 ===')
console.log(`已触发 GitHub Actions (${args.mode === 'hotfix' ? '仅前端单文件热更新' : '完整 APK + 热更新'})：`)
if (repoSlug) {
  console.log(`请打开 https://github.com/${repoSlug}/actions 查看构建进度，完成后手机端点击「检查更新」即可同步！`)
}
