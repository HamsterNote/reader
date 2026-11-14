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
| 3.2 | 等待 WebBase 集成实际 npm 包、移除其 portal/第二层 tracker | 未完成，不以库级 DOM 冒充完整 AC1/2 |
| 3.3 | 版本 3.0.3；等候 tag workflow 发布结果及 WebBase 集成 | 部分完成；native 未验证 |

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

