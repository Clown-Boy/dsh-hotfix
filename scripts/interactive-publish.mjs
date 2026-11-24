import { spawnSync } from 'node:child_process'
import { stdin as input, stdout as output } from 'node:process'
import readline from 'node:readline/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.status !== 0 && !options.allowFail) {
    const errText = options.capture ? result.stderr || result.stdout : ''
    throw new Error(`命令执行失败: ${cmd} ${cmdArgs.join(' ')}\n${errText}`.trim())
  }
  return result
}

function formatGitStatusLines(raw) {
  const labelMap = {
    '??': '[新增]',
    'M ': '[修改]',
    ' M': '[修改]',
    MM: '[修改]',
    'A ': '[新增]',
    'D ': '[删除]',
    ' D': '[删除]',
    'R ': '[重命名]',
  }
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2)
      const file = line.slice(3)
      const tag = labelMap[code] || `[${code.trim() || '变更'}]`
      return `  ${tag} ${file}`
    })
    .join('\n')
}

async function main() {
  console.log('========================================================')
  console.log('  DeepSeek Chat - 一键选择提交并发布 (交互式)')
  console.log('========================================================\n')
  const rl = readline.createInterface({ input, output })
  try {
    console.log('=== 当前仓库改动检查 ===')
    const statusText = run('git', ['-c', 'core.quotePath=false', 'status', '--short'], {
      capture: true,
    }).stdout.trimEnd()

    if (statusText) {
      console.log('检测到以下未提交的本地改动：\n')
      console.log(formatGitStatusLines(statusText))
      console.log('')

      const confirmCommit = (await rl.question('是否先提交这些本地修改？[Y/n] (默认 Y): ')).trim()
      if (confirmCommit && !['y', 'yes'].includes(confirmCommit.toLowerCase())) {
        console.log('已取消提交，操作结束。')
        return
      }

      const defaultMsg = 'feat: update custom features'
      const customMsg = (
        await rl.question(`请输入 Commit 提交说明 (直接回车默认 "${defaultMsg}"): `)
      ).trim()
      const commitMsg = customMsg || defaultMsg

      run('git', ['add', '.'])
      run('git', ['commit', '-m', commitMsg])
      console.log('')
    } else {
      console.log('当前工作区干净，没有待提交的新改动。\n')
    }

    console.log('请选择接下来要执行的操作：')
    console.log('  [1] 同步上游（如有）并发布前端热更新 (hotfix，推荐，几十秒完成)')
    console.log('  [2] 同步上游（如有）并编译发布完整 APK (full，版本号自动 +1)')
    console.log('  [3] 仅推送代码到 origin/main（不触发 Release 发布）')
    console.log('  [0] 暂不推送，直接退出\n')

    const choice = (await rl.question('请输入选项编号 [1/2/3/0] (默认 1): ')).trim() || '1'
    console.log('')

    if (choice === '0') {
      console.log('已取消推送，退出。')
      return
    }

    if (choice === '1') {
      run(process.execPath, [
        path.join(root, 'scripts', 'sync-upstream.mjs'),
        '--mode',
        'hotfix',
        '--force',
      ])
    } else if (choice === '2') {
      run(process.execPath, [
        path.join(root, 'scripts', 'sync-upstream.mjs'),
        '--mode',
        'full',
        '--force',
      ])
    } else if (choice === '3') {
      run('git', ['push', 'origin', 'main'])
      console.log('\n已推送到 origin/main（未触发 Release 标签）。')
    } else {
      console.error(`无效选项: ${choice}`)
      process.exitCode = 1
    }
  } finally {
    rl.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
