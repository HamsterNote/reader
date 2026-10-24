/* eslint-disable sonarjs/no-os-command-from-path -- Tests invoke the installed Git toolchain without a shell. */
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const patchFile = resolve(
  'patches/react-native-webview-13.15.0-ios-edit-menu.patch'
)
const script = pathToFileURL(
  resolve('scripts/apply-ios-webview-patch.mjs')
).href
const fixtures: string[] = []

function fixture(version = '13.15.0'): string {
  const root = mkdtempSync(resolve(tmpdir(), 'reader-ios-patch-'))
  fixtures.push(root)
  mkdirSync(resolve(root, 'apple'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ version }))
  const source = readFileSync(
    resolve('node_modules/react-native-webview/apple/RNCWebViewImpl.m'),
    'utf8'
  )
  writeFileSync(resolve(root, 'apple/RNCWebViewImpl.m'), source)
  if (source.includes('RNCShouldSuppressSystemEditMenu'))
    execFileSync('git', ['apply', '--no-index', '--reverse', patchFile], {
      cwd: root
    })
  return root
}

function apply(root: string): string {
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'const { applyIosWebViewPatch } = await import(process.argv[1]); console.log(applyIosWebViewPatch(process.argv[2]));',
      script,
      root
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
}

afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('pinned iOS WebView patch delivery', () => {
  it('applies to pristine sources and is idempotent', () => {
    const root = fixture()
    const before = readFileSync(resolve(root, 'apple/RNCWebViewImpl.m'), 'utf8')
    expect(apply(root)).toBe('applied')
    const patched = readFileSync(
      resolve(root, 'apple/RNCWebViewImpl.m'),
      'utf8'
    )
    expect(patched).not.toBe(before)
    expect(apply(root)).toBe('already applied')
    expect(readFileSync(resolve(root, 'apple/RNCWebViewImpl.m'), 'utf8')).toBe(
      patched
    )
    execFileSync('git', ['apply', '--no-index', '--reverse', patchFile], {
      cwd: root
    })
    expect(readFileSync(resolve(root, 'apple/RNCWebViewImpl.m'), 'utf8')).toBe(
      before
    )
  })

  it('rejects unsupported versions without changing native sources', () => {
    const root = fixture('13.16.0')
    const before = readFileSync(resolve(root, 'apple/RNCWebViewImpl.m'), 'utf8')
    expect(() => apply(root)).toThrow('requires react-native-webview 13.15.0')
    expect(readFileSync(resolve(root, 'apple/RNCWebViewImpl.m'), 'utf8')).toBe(
      before
    )
  })

  it('fails on divergent sources without partially applying the patch', () => {
    const root = fixture()
    const path = resolve(root, 'apple/RNCWebViewImpl.m')
    const source = readFileSync(path, 'utf8').replace(
      '"_CUSTOM_SELECTOR_"',
      '"upstream-changed"'
    )
    writeFileSync(path, source)
    expect(() => apply(root)).toThrow('Cannot apply iOS edit-menu patch')
    expect(readFileSync(path, 'utf8')).toBe(source)
  })
})
