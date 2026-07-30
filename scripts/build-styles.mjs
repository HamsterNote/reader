import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { compile } from 'sass'

const require = createRequire(import.meta.url)

const readerStylesPath = 'src/styles/index.scss'
const distStylePath = 'dist/style.css'
const dependencyStyles = [
  {
    specifier: '@hamster-note/components/styles.css',
    marker: '.hn-button'
  },
  {
    specifier: '@hamster-note/selection/style.css',
    marker: '.hsn-selection-container'
  }
]
const dependencyImportPattern =
  /^[ \t]*@import[ \t]+url\(['"]@hamster-note\/(?:components\/styles|selection\/style)\.css['"]\);[ \t]*$/gm

function buildReaderCss() {
  const result = compile(readerStylesPath, {
    sourceMap: false,
    style: 'expanded'
  })

  return result.css
}

function removeDependencyImports(css) {
  return css.replace(dependencyImportPattern, '').trimEnd()
}

function readDependencyCss({ specifier, marker }) {
  const dependencyStylePath = require.resolve(specifier)
  const css = readFileSync(dependencyStylePath, 'utf8')

  if (!css.includes(marker)) {
    throw new Error(`${specifier} did not contain ${marker}`)
  }

  return css.trimEnd()
}

function writeBundledCss() {
  const readerCss = removeDependencyImports(buildReaderCss())
  const dependencyCss = dependencyStyles
    .map((style) => `/* ${style.specifier} */\n${readDependencyCss(style)}`)
    .join('\n\n')
  const bundledCss = `${readerCss}\n\n${dependencyCss}\n`

  mkdirSync(dirname(distStylePath), { recursive: true })
  writeFileSync(distStylePath, bundledCss)
}

writeBundledCss()
