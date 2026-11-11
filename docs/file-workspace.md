# 文件工具栏与 reader 会话（3.0.0）

Reader 直接消费 `@hamster-note/painting/toolbar` 的 `ToolbarShell`、`ToolbarPopover`、`ToolbarFileMenu`。没有复制工具栏或文件列表实现。要求 painting **0.8.4**（精确 peer 依赖）；源码开发使用 `vendor/hamster-note-painting-0.8.4-57a82fb.tgz` 的同版本官方构建包，来自 painting PR #48 / commit 57a82fb。该包尚未发布到 npm。合并顺序为 painting #48 → reader 本 PR；发布顺序为 painting 0.8.4 → reader 3.0.0 → 宿主依赖接线。此 PR 不发布 npm，也不修改 WebBase。

painting 从传递依赖改为必选 peer，属于安装契约变化，因此 reader 使用 **3.0.0**。宿主需显式安装 `@hamster-note/painting@0.8.4`；Reader 的旧 props 和底栏插槽保持兼容。

## 现有 Reader 的可选输入

`files / currentFileKey / paneId / busy / onSelectFile / onRequestRemove` 使用 painting 的公开结构类型，均从 reader 根入口重新导出。宿主维护规范身份、已解析格式、有序列表和移除确认。没有 files 时隐藏文件入口；单项不可移除。选择回调的 `paneId` 在菜单打开时固定，返回 `success / cancelled / failed`；成功前不提前修改菜单当前项。Reader 不枚举存储或按后缀猜格式。

默认工具栏新增“目录”，打开当前文档既有页面/章节视图，无章节目录时提示并保留页面导航。`showPageBrowser` 继续支持受控；受控宿主需用 `onPageBrowserOpenChange` 回写开关值，关闭也继续调用 `onPageBrowserClose`。省略 showPageBrowser 即由 Reader 内部管理；切文件重置内部目录开关。webview 自带 surface 已移除重复按钮；WebBase/native 的重复入口由后续宿主接线任务移除。

`bottomBar` 保持原行为：undefined 使用默认栏，null 禁用，自定义节点完整替换，不叠加新栏。自定义栏由宿主自行预留空间。

`layout: PaneToolbarLayout` 与 painting 相同。边缘通过 `edge: top | bottom` 指定，显式 insets 取代整屏 env 值；顶部避让为 `max(insets.top, headerContentInset)` 加 16px 浮动间隔，底部为 bottom 加 16px。headerContentInset 是从栏原点起算的有效遮挡终点。Reader 测量完整共享外壳（含绘图辅栏）并在对应 top/bottom 预留正文空间；分页控件向底部安全区内侧移动，底边主栏与分页分行避让。layout 变化不更换文档引擎。不要在 containMarginTop/Bottom 中重复传入已经消费的安全区。

## 同容器文件切换

根入口提供 `ReaderFileSession`、`ReaderFileWorkspace` 和 `createReaderByteFileAdapter`。一个 pane 持有一个稳定 session，宿主先渲染 Workspace，然后 `await session.open(fileKey)`。Workspace 外容器与 WebView/page 不因切文件重建，内部文档引擎可以重建。

```tsx
const adapters = ['pdf', 'epub'].map((format) =>
  createReaderByteFileAdapter({
    format, // TypeScript 中保持为 'pdf' | 'epub'
    read: (file) => authorizedRead(file.storageId, file.path),
    props: async (file) => ({
      data: await loadReaderData(file),
      onDataChange: enqueueExistingSave
    }),
    workerSrc: '/assets/pdf.worker.min.mjs'
  })
)
const session = new ReaderFileSession({
  paneId: 'left',
  files: () => hostFiles,
  adapters,
  host: {
    supports: (format) => hostSupports(format),
    save: async (request) => {
      // 冲刷原有保存队列，等待真实持久化 ACK；拒绝/冲突/超时必须 throw。
      // request.data 是最新阅读数据；persistPosition=false 时只保存正文/批注，
      // 不覆盖单份持久最近位置（非活动栏仍保留自己的会话位置）。
      await persistAndFlushExistingQueue(request)
    },
    handover: async (request) => {
      const accepted = await prepareHostEditor(request.file, request.paneId)
      if (!accepted) return { status: 'cancelled' }
      await request.release() // 保存已确认；先释放 reader 再装载新编辑器
      await mountHostEditor(request)
      return { status: 'success' }
    },
    commit: async (request) =>
      commitHostCurrentFile(request.paneId, request.fileKey),
    reload: async (request) => reloadFromHostStorage(request) // 必选失败回退
  }
})
// <ReaderFileWorkspace session={session} files={hostFiles} layout={paneLayout} />
// 宿主关闭时先完成自身保存屏障，再 await session.dispose()。
```

能力来自实际注册 adapters 与目标 `resolvedFormat` 的交集：PDF/EPUB 注册 byte adapter；TXT 只有注册可用 adapter 后才能原地切换；HNN/HPB 通过异步 handover；双方均不支持的格式直接拒绝，保持旧文档。扩展适配器的 load 返回 ReaderProps 与异步 dispose，负责自身兼容文档加载和定位能力。非 byte 适配器的初始视图按 Reader 的兼容文档同步挂载契约就绪，不可把未就绪的异步内容伪装成同步文档。

事务顺序：冻结新输入 → 等已有指针手势提交 → Reader `progressRef.flush()` 捕获稳定真实位置并冲刷原进度队列 → host.save ACK → 卸载视图并等待引擎 disposal → 释放无引用文档 → 装载目标 → 布局与位置恢复完成 → host.commit。保存失败不卸载，取消宿主接管不提交。切换单飞；旧 sessionId 进度、ready、error 不影响新文档；恢复期间初始化 progress 不回传。失败自动调用一次必选 host.reload，回退也失败时提供重试和从存储重开原文件，不保留旧重引擎或写入空数据。

位置缓存仅含 layoutReadingProgress / textReadingProgress，键为 storageId、规范 path、paneId；优先使用本栏位置，否则使用适配器从持久层加载的数据，再否则默认起点。沿用原 PDF 页码+文字锚点/页内百分比、EPUB 兼容字符锚点恢复；无法精确定位时原引擎提示并回退有效页，不修改批注和原存储定位。

PDF 文字视图与原布局引擎共用 `onEngineReady/onEngineError`：等待目标页、字体、实际分页测量与位置变换完成后才通知 ready，每个文档 generation 一次；挂载或正文初现均不代表恢复成功。目标页加载、字体或布局失败通知 error。Workspace 用该通知解除恢复屏障，打包 WebView 用同一通知发送 document-ready 或 ENGINE_FAILURE；失败继续走既有宿主重载路径。

双栏可共享 `new ReaderFileResourcePool(2)`（单栏可用 limit=1）。源数据/索引按规范身份引用计数，最后一个引用释放后才销毁；每栏仍有独立引擎和历史。池内 adapter.load 返回的 props 仅放共享且不含栏状态的文档/source；每栏数据和回调使用 adapter.viewProps，byte adapter 的 props 回调自动走此路径。不要将每栏选区、历史、回调放进共享 load 结果。资源销毁中的条目仍计入上限并拒绝重新获取。宿主用 `isActivePane` 指明持久最近位置的写入权。池不缓存非活动文档。

## WebView 的可选会话替换

`createReaderHostWorkspace` 在既有 `createReaderHostSession` 上增加 replaceDocument：先执行旧 close/ACK 屏障；失败保留原会话；成功后才发送 `reader:replace-session` 控制消息。宿主通过 sendReplacement 注入既有通道，不替换 WebView source/key。内置 webview 入口校验 sourceToken + previousSessionId + fresh sessionId，重建 document bridge client，沿用同一个 React root，并串行等待旧引擎/worker 的异步清理；新 client 发送 ready 后继续原有 open→restore 流程；引擎布局与位置恢复完成后发送可选 document-ready，replaceDocument 才返回 replaced，宿主此时才能提交当前项。该事件只对会话替换宿主启用，旧宿主不收到新事件。v1 文档包络与旧宿主保持兼容。

reload 回调为必选。webview 的 open/restore 引擎失败通过带 `stage: document` 的 ENGINE_FAILURE 报告，宿主对当前 session 只触发一次 reload；过期错误、重复错误和关闭冲刷错误不会触发文档重载。宿主回调须从持久存储重开，不使用失败中的空视图覆盖数据。新 sessionId 必须全程唯一，不循环复用。该能力是可选公开接线，不自动接入 WebBase；开发验收为 Web-only，不宣称原生实机验证。

## 验证与回滚

文字模式回归：`yarn check:workspace` 包含首次打开文字模式、PDF→EPUB→PDF 文字模式往返两条场景；`yarn check:pdf-text-readiness` 对打包 WebView 运行相同位置恢复路径。均断言真实文字栏定位完成、宿主随后提交、没有 reload；另有单元测试覆盖字体等待、加载与布局失败。两份浏览器检查分别需要先完成 lib 与 webview 构建。

PDF 进度及模式切换兼容检查可运行 `READER_PROGRESS_WIDTH=320 READER_PROGRESS_SCALE=1 node scripts/check-reading-progress.mjs`，在窄栏覆盖安全区、文字/无文字页面、Layout/Text 往返与位置恢复。该命令使用浏览器，完整默认矩阵可省略两个环境变量；不运行原生构建或实机验收。

`yarn typecheck`、`yarn lint`、`yarn test:run`、`yarn build:lib`、`yarn pack:check`，以及在构建后运行 `yarn check:workspace`（直接加载 dist）验证 Web 契约；另在 `yarn build:webview`（纯 Web 资产构建）后运行 `yarn check:session-replacement` 验证打包入口的会话替换。浏览器输出在调用者的 artifacts/reader-workspace-browser。旧宿主继续使用 Reader 单文档 props，不需要采用 Workspace。回滚恢复 reader/painting 依赖和入口即可；源文件、批注、组合与持久位置不转换、不删除。
