import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const bannedPrefixes = ['demo/', 'demo-dist/', 'src/', 'test/', '.github/']
const allowedExactPaths = new Set([
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md'
])
const allowedPrefixes = ['dist/']

function getNpmCliPath() {
  const nodeBinDir = dirname(process.execPath)
  const npmCliCandidates = [
    resolve(nodeBinDir, '../lib/node_modules/npm/bin/npm-cli.js'),
    resolve(nodeBinDir, '../libexec/lib/node_modules/npm/bin/npm-cli.js')
  ]

  const npmCliPath = npmCliCandidates.find((candidatePath) =>
    existsSync(candidatePath)
  )

  if (npmCliPath == null) {
    throw new Error(
      'Failed to resolve npm-cli.js from the current Node installation'
    )
  }

  return npmCliPath
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function getPackedFiles() {
  const result = spawnSync(
    process.execPath,
    [getNpmCliPath(), 'pack', '--json', '--dry-run'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  if (result.error) {
    throw new Error(`Failed to run npm pack: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    const stdout = result.stdout.trim()
    throw new Error(
      stderr || stdout || `npm pack exited with code ${result.status}`
    )
  }

  const stdout = result.stdout.trim()

  if (stdout.length === 0) {
    throw new Error('npm pack returned empty output')
  }

  let parsed

  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse npm pack JSON output: ${message}`)
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('npm pack JSON output did not contain a package entry')
  }

  const [packResult] = parsed

  if (!Array.isArray(packResult.files)) {
    throw new Error('npm pack JSON output did not include a files list')
  }

  return packResult.files.map((file) => normalizePath(file.path))
}

function isAllowedPath(filePath) {
  return (
    allowedExactPaths.has(filePath) ||
    allowedPrefixes.some((prefix) => filePath.startsWith(prefix))
  )
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

try {
  const packedFiles = getPackedFiles()
  const bannedFiles = uniqueSorted(
    packedFiles.filter((filePath) =>
      bannedPrefixes.some((prefix) => filePath.startsWith(prefix))
    )
  )
  const unexpectedFiles = uniqueSorted(
    packedFiles.filter((filePath) => !isAllowedPath(filePath))
  )

  if (bannedFiles.length > 0 || unexpectedFiles.length > 0) {
    const messageLines = ['Pack check failed.']

    if (bannedFiles.length > 0) {
      messageLines.push(
        '',
        'Banned paths detected:',
        ...bannedFiles.map((filePath) => `- ${filePath}`)
      )
    }

    if (unexpectedFiles.length > 0) {
      messageLines.push(
        '',
        'Unexpected published files:',
        ...unexpectedFiles.map((filePath) => `- ${filePath}`)
      )
    }

    messageLines.push(
      '',
      'Allowed paths: dist/**, package.json, README.md, LICENSE, CHANGELOG.md'
    )

    console.error(messageLines.join('\n'))
    process.exit(1)
  }

  console.log(`Pack check passed with ${packedFiles.length} files.`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}
