# Design

## Context

动机见 proposal.md。已确认目标为 HamsterNote/reader，当前依赖 painting 0.8.3，绘图文档为 schema 3。

- `src/types/selection.ts` 明确历史仅含 ranges、rects、选中 ID；`test/types.test.ts` 还断言 pagePaintings 不在历史键中，需要同步调整。
- `Reader/useAnnotationHistory.ts` 用 use-undo checkpoint 保存快照；syncPresent / syncSilent 会调用 set，因此不能直接用于需要保留 future 的等价回显或纯显示变化。
- `EngineDocumentViewer.tsx` 与 `IntermediateDocumentViewer.tsx` 各有自己的历史路径；Reader 的 `handlePagePaintingChange` 只合并页 map、更新非受控值并发出绘图回调，没有 checkpoint。
- `PageDrawingLayer.tsx` 按文件身份、pageId、外部文档变化管理局部 controller，订阅已提交 document；`test/page-drawing-layer.test.tsx` 已覆盖一笔一次、取消、受控回显不重复提交。不能用其局部历史作为文件历史。
- `webview/src/ReaderSurface.tsx` 分别处理绘图保存和历史回调，后者仅回填 ranges/rects；现有保存链已经支持完整 pagePaintings。
- 没有发现仓库自带 propose 命令／技能文件；采用本次安装的 openspec-propose 技能、CLI 1.13.1 和项目 spec-driven schema。

## Goals / Non-Goals

**Goals:** 一个文件一个历史所有者、一次提交一个 checkpoint、一次回放原子更新所有相关数据；各视图及未挂载页面共享同一份历史。

**Non-Goals:** 新建绘图工具、实现绘图库算法、历史跨重启保存、旧存储迁移、调整现有高亮和矩形的操作粒度、扩大现有 selectionRef.clear 的清除范围。只接入当前已公开的绘图编辑能力；未提供的擦除／整笔重绘入口不在此 change 新增。

## Decisions

### 1. 文件级统一快照与单一历史所有者

将既有 useAnnotationHistory 的所有权提升到 Reader 文件会话层，向 Engine 与 Intermediate viewer 注入同一控制器／提交接口和历史状态；逐步替换它们现有独立实例。绘图回调在 Reader 入口提交，文字／矩形沿各自既有确认边界提交。文件内容与当前快照用同步 ref 顺序合并，再发布 React 状态，防止同一批快速笔迹以旧 render 值互相覆盖。

历史值以兼容扩展增加 `pagePaintings?: ReaderPagePaintingMap`；内部始终使用完整 map。外部未提供字段表示不更新绘图，显式 `{}` 表示清空。历史快照覆盖所有页，并保留完整 EditorDocument；用不可变页级结构共享控制内存，不能引用之后会被 controller 原地改变的对象。

备选：按钮根据当前绘图模式调用局部 controller.undo。拒绝原因是高亮／绘图时序错误、翻页卸载丢历史且无法回放未挂载页。独立两栈加时间戳需要额外协调分支，采用既有全量快照更易保留当前契约。

### 2. 操作边界和 redo 规则

| 行为 | 历史粒度 |
| --- | --- |
| 新增手绘 | pointer down 到成功提交的完整 stroke 一项，所有采样点归入该项 |
| 新增形状 | 一次完成的形状一项 |
| 已支持的对象编辑／整笔重绘 | 一次完成的编辑一项，恢复原对象及属性；不得拆成删除＋新增两项 |
| 已支持的擦除 | 一次手势一项，即使涉及多对象／片段，整体恢复 |
| 已支持的删除／当前页绘图清空 | 一次命令一项；页清空不触及其他页或文字／矩形 |
| 取消、多指取消、空擦除、空清空 | 零项，保留 future |
| 几何重算、显示重绘、工具／下一笔样式设置 | 零项，保留 future |

以真实已提交文档内容判等，不将显示缓存或仅修订号变化当作用户编辑。新有效提交统一 setCheckpoint 并清空整个 future，包含所有页和标注类型。回放走专门的 apply 来源，不再提交 checkpoint；受控等值回显直接确认，不经过会丢失 future 的 set 路径。保留既有文字选中行为，但禁止绘图外观更新顺带重写内容历史。

PageDrawingLayer 已有 document 提交订阅可复用；不得假定一次任意文档通知都等于一次用户操作。对现有公开编辑路径验证操作终点；若一次用户编辑包含多次通知，在 Reader 适配边界按该操作事务合并。无需新增工具来满足粒度契约。命令执行前取消活跃未提交手势：通过页控制器的公开输入取消能力或受控重建当前页会话实现，不合成一次抬笔提交。

### 3. 受控应用、回调与保存去重

由 Reader 根据每一数据字段的受控情况决定本地更新或通过 onAnnotationHistoryChange 交付完整目标。所有涉及受控目标的回放都先验证有历史回填处理器；没有处理器则不移动栈，命令结果和 canUndo/canRedo 一致。保留原有非绘图受控限制。

新增统一来源 `drawing`（用于已提交绘图），原有 undo/redo/reset 来源不变。普通绘图提交保留原有 onPagePaintingChange / onPagePaintingsChange 回调，历史回调也可报告目标与状态；宿主将 drawing 来源的历史回调作为状态通知，内容只在既有绘图回调入口保存。undo/redo 则通过历史回调原子回填 ranges、rects、pagePaintings 并保存一次，禁止回放再触发普通绘图变更保存。非受控 Reader 同样在统一 apply 内更新绘图并对外提供历史目标。

ReaderSurface 需遵循此来源路由，不能继续只回填 ranges/rects，也不能在两个回调里重复调用 dataChange。逻辑保存去重不禁止既有可靠传输层对同一保存请求的重试。绘图回调、历史回调的顺序与一次保存断言通过集成测试固定。

### 4. 文件身份、外部更新与持久化

文件身份和 annotationHistory.resetKey 驱动统一 reset；页面挂载、翻页及视图切换不 reset。保留 DrawingDocumentContext 防止 A/B 文件中相同 pageId 共用 controller。回放更新整页 map，即使该页未挂载，下次挂载也必须以目标文档重建。

以当前已提交目标及待确认的本地产物识别受控回显，内容相同不重置。不同外部内容替换取消待提交手势并重置基线与双栈；不能用 external-sync 静默拼接旧历史。save ack 只确认请求，不写历史。沿用现有 V5 保存与恢复，不把历史栈存入 annotation blob。

备选：每个 props 新引用都 reset。拒绝原因是受控宿主通常每次保存都返回新对象，会使正常历史不可用。只按文件身份 reset 也不够，会让旧目标覆盖真正的外部替换。

## Risks / Trade-offs

- [与 replace-pdf-painting-core 并行修改 Reader／绘图入口] → apply 基于实际合入版本串行整合，复用其文档／保存链；本 change 不改其任务或存储 requirement。主规格 v4 与实现 V5 的差异由该 change 收口。
- [快照占用随笔迹增长] → 页级结构共享，历史中只存已提交文档，无逐帧复制；以长笔迹和多页样本验证，不在本次预设新的历史截断策略。
- [重复回调清除 redo 或重复保存] → 显式区分 drawing、undo/redo、echo、reset，在 Reader 和 ReaderSurface 联合验证。
- [绘图库操作事务与通知数量不一致] → 对当前 0.8.3 已支持入口验证终点并合并，避免用通知次数定义粒度；若公开 API 无法满足则作为明确依赖缺口报告，不改用私有 API。

## Migration Plan

1. 先扩展公共历史类型与快照兼容，再提升历史所有权，接入两个 viewer 和绘图提交／回放。
2. 更新 WebView 来源分流与完整回填，补齐类型、历史、绘图、Reader、保存链回归；完成现有绘图浏览器验证。
3. 不迁移存储数据。回退时恢复此前代码，当前文档仍走原保存格式；会话历史允许丢弃。

## Open Questions

无需要用户裁决的未决问题。上述是本提案建议的验收契约，尚未经过用户验收；不将其表述为用户已逐项确认。
