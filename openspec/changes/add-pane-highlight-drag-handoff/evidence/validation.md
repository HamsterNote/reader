# reader 开发验证（Web-only）

环境：Linux / Ubuntu 26.04，Node v24.15.0，Corepack Yarn 1.22.22，Chromium 148.0.7778.96。基线 HEAD 与 origin/main 均为 `82ada7e06c869fa4a43fdde9f7856c28dd666420`，开工时工作树干净。

执行时间：2026-11-14 17:28–17:49 +08:00。实际库级 DOM payload 与执行起止时间见 `handoff-browser.json`。宿主 ACK 在该脚本中由测试 callback 提供，不能代表 native 接管/ghost/跨栏通过。

| 任务 | 命令与证据 | 结论 |
| --- | --- | --- |
| 1.1 | yarn typecheck；test/highlight-handoff-public-types.ts；库产物声明 | 兼容旧接口，导出新接口 |
| 1.2 | yarn test:run test/highlight-handoff.test.tsx；yarn check:highlight-handoff | 三种实际渲染面范围深相等，JSON 完整，新旧不双发 |
| 2.1 | 同上 | 500ms/4px、鼠标阈值、pen 拒绝、多指/提前释放；新路径无 tracker/ghost |
| 2.2 | 同上 | 250ms 边界、迟到 ACK、接管前 move/end、接管后不双发、源取消不反向终结 host owner |
| 2.3 | yarn check:highlight-handoff；生命周期单测 | 三种渲染面各 20 次真实文档重开；旧计时器不复活；失焦/替换/卸载清理 |
| 3.1 | yarn typecheck；yarn test:run；yarn build:lib；yarn pack:check；yarn check:web-selection；READER_BROWSER_CASE=chromium yarn check:browser | 见原始输出 |
| 3.2 | WebBase PR #91 实际安装 npm 3.0.4；PDF Text 竖屏左右完整 AC1–5、PDF Layout/EPUB 原触点跨栏插入实际通过；三面原 payload 深相等、reader 无 ghost；AC6 最终包实跑见下 | 库集成交付；宿主其余复测见 WebBase 记录，native 未验证 |
| 3.3 | v3.0.4 tag workflow 成功；npm 官方 registry 原始输出 `3.0.4`；共同夹具 SHA-256 一致 | 库发布完成；native 未验证 |

250ms 为评审批准的初始 bridge/host 接管响应预算：在 500ms 长按确认后另给最多四分之一秒，避免无响应时长时间保持输入抑制。它不是设备实测延迟阈值。具名常量 `HIGHLIGHT_HANDOFF_TIMEOUT_MS`，249ms/250ms 与迟到 accepted 均有用例。

既有 check:browser 断言仍检查旧 highlights 且禁止任何初始化写入，与现有明确的 V2–V4→V5 一次迁移冲突；已在干净基线复现。此次仅更新测试 oracle：确认一次迁移、公开字段不变、后续操作用 annotations，并按 PDF/EPUB 当前不同的手柄标签与实际文字坐标操作。未修改生产迁移逻辑。

完整无过滤 check:browser 记录保留：WebKit 在当前系统缺 libicudata.so.74，安装器报告不支持 ubuntu26.04-x64；未将该部分记为通过。Chromium 13/13（桌面/触屏、V2–V4、恶意 EPUB）单独执行通过。

## 原始输出摘录

### corepack yarn typecheck

```text
(node:2921832) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
$ tsc --project tsconfig.json --noEmit
Done in 11.77s.
```

### corepack yarn test:run

```text

 ✓ test/reader-ssr.test.tsx (1 test) 105ms

 Test Files  147 passed (147)
      Tests  1936 passed (1936)
   Start at  17:32:05
   Duration  147.96s (transform 15.66s, setup 79.12s, collect 70.72s, tests 226.48s, environment 229.88s, prepare 31.87s)

Done in 148.85s.
```

### corepack yarn test:run test/highlight-handoff.test.tsx test/text-highlight-drag.test.tsx

```text

 ✓ test/text-highlight-drag.test.tsx (6 tests) 440ms

 Test Files  2 passed (2)
      Tests  21 passed (21)
   Start at  17:47:38
   Duration  3.33s (transform 1.44s, setup 345ms, collect 2.08s, tests 512ms, environment 984ms, prepare 159ms)

Done in 3.83s.
```

### corepack yarn build:lib

```text
(Use `node --trace-deprecation ...` to show where the warning was created)
$ tsc --project tsconfig.build.json
(node:2923378) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
$ node scripts/build-styles.mjs
Done in 9.81s.
```

### corepack yarn pack:check

```text
$ node scripts/check-pack.mjs
Pack check passed with 411 files.
Done in 1.99s.
```

### corepack yarn check:web-selection

```text
      "customSeekPage": 2
    },
    "popoversAfterDismiss": 0
  },
  {
    "label": "epub-layout-toc",
    "passed": true
  },
  {
    "label": "epub-text-toc",
    "passed": true
  },
  {
    "geometryCases": 120,
    "label": "shared-selection-interaction",
    "passed": true,
    "combinations": 36
  }
]
Done in 208.67s.
```

### READER_BROWSER_CASE=chromium corepack yarn check:browser

```text
chromium-desktop-epub-v4-security: engine mounted
Browser integration: 13/13 passed; artifacts: /home/zhangxiao/multica_workspaces/hamster-arm-d6b65621f809/ham-235-5f86b102bf7a/workdir/evidence/reader-browser-chromium
Done in 40.09s.
```

### npm view @hamster-note/reader version （发布前）

```text
3.0.2
```


## 3.0.4 compatibility follow-up

Time: 2026-11-14T10:04:06.532795+00:00
Environment unchanged: Ubuntu26.04, Node24.15.0, Yarn1.22.22; jsdom PDF geometry is explicitly mocked.

WebBase 3.0.2 carries a bundled PDF hidden-layout patch absent from reader main. Ported its behavior into reader source so upgrading does not lose that fix. Attached/positive layout is required before PDF.js navigation; ResizeObserver/rAF wakes pending navigation; 10s timeout retains scroll and shows a visible error, with no unsafe restore fallback.

### corepack yarn test:run

```text

 ✓ test/reader-ssr.test.tsx (1 test) 29ms

 Test Files  148 passed (148)
      Tests  1946 passed (1946)
   Start at  18:01:47
   Duration  63.58s (transform 8.93s, setup 27.54s, collect 34.68s, tests 114.68s, environment 83.16s, prepare 12.73s)

Done in 64.06s.
```

### corepack yarn typecheck

```text
yarn run v1.22.22
(node:2936493) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
$ tsc --project tsconfig.json --noEmit
Done in 10.01s.
```

### corepack yarn build:lib

```text
dist/index-BaAn4MiP.js                 809.90 kB │ gzip: 195.90 kB
✓ built in 2.58s
(node:2930422) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
$ tsc --project tsconfig.build.json
(node:2930522) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
$ node scripts/build-styles.mjs
Done in 13.61s.
```

### corepack yarn pack:check

```text
yarn run v1.22.22
(node:2936538) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
$ node scripts/check-pack.mjs
Pack check passed with 413 files.
Done in 1.72s.
```

### npm view @hamster-note/reader version --registry=https://registry.npmjs.org --prefer-online (before v3.0.4)

```text
3.0.3
```

## 3.0.4 发布及共同夹具（2026-11-14 18:35–18:47 +08:00）

3.0.4 发布源 commit `224f697`，通过 `v3.0.4` tag 触发 GitHub workflow 成功：
https://github.com/HamsterNote/reader/actions/runs/43583504402 。没有本地 npm publish。
发版前 npm 官方 registry 为 `3.0.3`，3.0.4 大于该版本；官方发布后查询原始输出：

```text
3.0.4
```

命令：`npm view @hamster-note/reader version --registry=https://registry.npmjs.org --prefer-online`。
默认 yarn 镜像曾缓存旧 latest，使用官方 registry 强制在线查询。

3.0.4 将 WebBase 原 3.0.2 隐藏 PDF 布局补丁迁回 reader 源码，防止升级丢失布局就绪屏障。实际安装 3.0.4 的 WebBase 隐藏布局/超时/取消/缩放/分栏 6 个浏览器用例已通过；WebBase 没有复制 reader 源码。

共同 JSON 夹具按字节相同：`sha256sum test/fixtures/highlight-handoff.json ../WebBase/shared/highlight-handoff.fixture.json`：

```text
f91e5775e533364c5660185f2ae773868c085d4651e059d8461696efd783c113  test/fixtures/highlight-handoff.json
f91e5775e533364c5660185f2ae773868c085d4651e059d8461696efd783c113  ../WebBase/shared/highlight-handoff.fixture.json
```

共同夹具与布局测试类型整理：`corepack yarn typecheck` 通过；`corepack yarn test:run test/highlight-handoff.test.tsx test/pdf-layout-ready.test.ts` 22 用例通过。无生产源码变化，不需再发版本。

3.0.4 实际库浏览器复跑 `corepack yarn check:highlight-handoff` 三面各 20 次重开通过；原始完整结果随 issue 附件 `reader-handoff-304.log` 与 `reader-handoff-304/report.json`。

## 最终 3.0.4 单栏实跑复核（2026-11-14）

生产源码为 `224f697`（v3.0.4），测试/共同夹具为 `bc9d384`；环境同上。

命令：`corepack yarn check:web-selection`；附加环境：`{}`；开始 `2026-11-14T19:21:43.249540+08:00`，结束 `2026-11-14T19:25:05.907550+08:00`，退出码 `0`。完整日志 `reader-selection-304-release.log`。

```text
    "passed": true
  },
  {
    "label": "epub-text-toc",
    "passed": true
  },
  {
    "geometryCases": 120,
    "label": "shared-selection-interaction",
    "passed": true,
    "combinations": 36
  }
]
Done in 202.37s.
```

命令：`corepack yarn check:browser`；附加环境：`{"READER_BROWSER_CASE": "chromium"}`；开始 `2026-11-14T19:25:05.907786+08:00`，结束 `2026-11-14T19:25:48.277622+08:00`，退出码 `0`。完整日志 `reader-browser-304-release.log`。

```text
chromium-mobile-epub-v3: opening
chromium-mobile-epub-v3: engine mounted
chromium-mobile-epub-v4: opening
chromium-mobile-epub-v4: engine mounted
chromium-mobile-pdf-v2: opening
chromium-mobile-pdf-v2: engine mounted
chromium-mobile-pdf-v3: opening
chromium-mobile-pdf-v3: engine mounted
chromium-mobile-pdf-v4: opening
chromium-mobile-pdf-v4: engine mounted
chromium-desktop-epub-v4-security: opening
chromium-desktop-epub-v4-security: engine mounted
Browser integration: 13/13 passed; artifacts: /home/zhangxiao/multica_workspaces/hamster-arm-d6b65621f809/ham-235-5f86b102bf7a/workdir/ham91-browser
Done in 42.15s.
```

最终包上的真实 Chromium 单栏 AC6 仍通过：36 组选择/复制/批注/手柄等交互，120 个几何用例；13/13 桌面/触屏旧快照、选择、保存重开、安全回归。WebKit 和 native 未验证，不并入通过数。宿主 PR：https://github.com/HamsterNote/WebBase/pull/91 。

## WebBase 集成交付

WebBase PR #91 双 manifest 与锁均为 npm 3.0.4，移除旧 reader 3.0.2 产物补丁；旧 portal/第二 tracker 在新能力路径停用，保留旧宿主兼容。2026-11-14 19:23–20:14 +08:00 的普通矩阵：355/356 通过，唯一失败在上下分栏回跳前固定翻页次数不足（准备阶段），由宿主后续复测跟进。竖屏左右 PDF Text 的完整实际路由及 PDF Layout/EPUB 触摸插入通过。没有把该结果记为 native 通过。完整业务 JSON 与 DOM 证据随 HAM-235 结果附件交付。
