import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const patchFile = resolve(
  import.meta.dirname,
  '../patches/react-native-webview-13.15.0-ios-edit-menu.patch'
)

export function applyIosWebViewPatch(
  dependencyRoot = dirname(require.resolve('react-native-webview/package.json'))
) {
  const { version } = JSON.parse(
    readFileSync(resolve(dependencyRoot, 'package.json'), 'utf8')
  )
  if (version !== '13.15.0')
    throw new Error(
      `iOS edit-menu patch requires react-native-webview 13.15.0; found ${version}`
    )

  // --no-index applies to the installed dependency, without changing Git's index.
  const apply = (...args) =>
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Use the developer's Git toolchain with fixed arguments and no shell.
    spawnSync('git', ['apply', '--no-index', ...args, patchFile], {
      cwd: dependencyRoot,
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: dependencyRoot }
    })
  if (apply('--reverse', '--check').status === 0) return 'already applied'
  const check = apply('--check')
  if (check.status !== 0)
    throw new Error(
      `Cannot apply iOS edit-menu patch: ${check.stderr || check.error}`
    )
  const result = apply()
  if (result.status !== 0)
    throw new Error(
      `Cannot apply iOS edit-menu patch: ${result.stderr || result.error}`
    )
  if (apply('--reverse', '--check').status !== 0)
    throw new Error('iOS edit-menu patch verification failed')
  return 'applied'
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(`iOS WebView edit-menu patch: ${applyIosWebViewPatch()}`)
