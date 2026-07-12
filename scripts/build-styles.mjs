import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { compile } from 'sass'

const require = createRequire(import.meta.url)

const readerStylesPath = 'src/styles/index.scss'
const distStylePath = 'dist/style.css'
const selectionStyleSpecifier = '@hamster-note/selection/style.css'
const selectionImportPattern =
  /^[ \t]*@import[ \t]+url\(['"]@hamster-note\/selection\/style\.css['"]\);[ \t]*$/gm

function buildReaderCss() {
  const result = compile(readerStylesPath, {
    sourceMap: false,
    style: 'expanded'
  })

  return result.css
}

function removeSelectionImport(css) {
  return css.replace(selectionImportPattern, '').trimEnd()
}

function readSelectionCss() {
  const selectionStylePath = require.resolve(selectionStyleSpecifier)
  const css = readFileSync(selectionStylePath, 'utf8')

  if (!css.includes('.hsn-selection-container')) {
    throw new Error(
      `${selectionStyleSpecifier} did not contain .hsn-selection-container`
    )
  }

  return css.trimEnd()
}

function writeBundledCss() {
  const readerCss = removeSelectionImport(buildReaderCss())
  const selectionCss = readSelectionCss()
  const bundledCss = `${readerCss}\n\n/* ${selectionStyleSpecifier} */\n${selectionCss}\n`

  mkdirSync(dirname(distStylePath), { recursive: true })
  writeFileSync(distStylePath, bundledCss)
}

writeBundledCss()
