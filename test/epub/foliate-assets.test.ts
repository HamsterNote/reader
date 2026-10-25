// HAM-88 任务 2.1：foliate-js 自有资产完整性校验。
// 清单与来源见 vendor/foliate-js/MANIFEST.md；任何文件漂移都会使本测试失败，
// 保证干净环境构建使用的 ESM 资源与锁定版本逐字节一致。

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const VENDOR_ROOT = join(__dirname, '../../vendor/foliate-js')

const EXPECTED_ASSETS: ReadonlyArray<readonly [string, string]> = [
  [
    'view.js',
    'e0093af921feb03bb58fb51aeedc321fa108a4158d215f6913ecf7925415c945'
  ],
  [
    'epub.js',
    'dfe347495039e9b5991478986ec6b7713cf9efbcd8f475a77ef7b967c5176298'
  ],
  [
    'epubcfi.js',
    'e1a688ad5c84bf31f33cef467f92c7a6d060a0f17ec37c1d3c048e9c7b1cf645'
  ],
  [
    'paginator.js',
    '51cec81572d5d182e231fe68ce9c3b5489a0976b36172060516336ba893565ea'
  ],
  [
    'fixed-layout.js',
    '7aee1d15d8e0479b8a6c59a20304b250dafc4c7dc158147a2b2c6bed9e180b4c'
  ],
  [
    'progress.js',
    '544f5e90babc0cb31c5caf971a5f06dd6249ec06600cb62f672fa7179811fde1'
  ],
  [
    'overlayer.js',
    'd3d3396e3083277ccbd4f17c407621159b22a407107e43ce75ca3014578094fb'
  ],
  [
    'text-walker.js',
    '4ad740ab6142b5be428700ef4d270253cef6649cf6e047ae7d2698a7aec65e92'
  ],
  [
    'comic-book.js',
    '7f3bf77561ca77300d5244015fcb1f73805787db246928074dc49fb56c88762e'
  ],
  [
    'fb2.js',
    '09a7890bf191f1b6c6dd435fae2868b86c75e73e00731b0051c02f2a998a180a'
  ],
  [
    'mobi.js',
    '016526df13a9f11ee6671a8c74346e1cf41fe6bdfe50165fdcbf744f015694f3'
  ],
  [
    'search.js',
    '31e846bdc095a645de0e94f7baa2c9e136561a363a2f774d4032e72cfa1fb0ef'
  ],
  [
    'tts.js',
    '530d34605b758a5e2260438964a85bb9909bcb49e8848e303fe22cac63859026'
  ],
  [
    'vendor/zip.js',
    '2a0d43157e4a447c6e43351225758795b75a33e8dfec10c6767248df2182949a'
  ],
  [
    'vendor/fflate.js',
    'e63bcc21f83a43e5f71d5cbefd351ff4d4dbd57bef8b29ad65c8bd65752f6e6b'
  ],
  [
    'LICENSE',
    'b621ffc351fe263bc9b09dd0bc1c9332fda9c462a3904c1e4f0b4d3236b9c28c'
  ]
]

describe('foliate-js vendored assets', () => {
  it.each(EXPECTED_ASSETS.map(([file, sha256]) => ({ file, sha256 })))(
    '$file matches the pinned sha256',
    ({ file, sha256 }) => {
      const contents = readFileSync(join(VENDOR_ROOT, file))
      const actual = createHash('sha256').update(contents).digest('hex')
      expect(actual).toBe(sha256)
    }
  )

  it('ships the MIT license notice naming the upstream author', () => {
    const license = readFileSync(join(VENDOR_ROOT, 'LICENSE'), 'utf8')
    expect(license).toContain('MIT License')
    expect(license).toContain('John Factotum')
  })

  it('ships the zip.js BSD-3-Clause notice alongside the minified build', () => {
    const notice = readFileSync(
      join(VENDOR_ROOT, 'vendor/zip.js.LICENSE.txt'),
      'utf8'
    )
    expect(notice).toContain('BSD 3-Clause License')
    expect(notice).toContain('Gildas Lormeau')
  })

  it('loads as ESM in a clean environment and registers foliate-view', async () => {
    // 完整模块图（含动态 import 目标）都能解析：证明干净环境构建
    // 不依赖 native-reader checkout 或额外下载。
    const viewModule = await import('../../vendor/foliate-js/view.js')
    expect(viewModule.View).toBeTypeOf('function')
    expect(customElements.get('foliate-view')).toBe(viewModule.View)
    await import('../../vendor/foliate-js/epub.js')
    await import('../../vendor/foliate-js/paginator.js')
    await import('../../vendor/foliate-js/fixed-layout.js')
    await import('../../vendor/foliate-js/overlayer.js')
    await import('../../vendor/foliate-js/vendor/zip.js')
  })

  it('pdf.js stub fails loudly instead of missing the module', async () => {
    const pdfModule = await import('../../vendor/foliate-js/pdf.js')
    expect(() => pdfModule.makePDF()).toThrow(/not vendored/)
  })
})
