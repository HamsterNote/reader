# Tasks

本次仅完成 propose；以下实现及验证任务均未执行。实现以 reader 当前 painting 0.8.3 集成为基线，并与 replace-pdf-painting-core 的最终合入版本衔接。

## 1. 历史数据契约与单一所有者

- [ ] 1.1 扩展 src/types/selection.ts 的可选 pagePaintings 历史值及 drawing 来源，更新公开注释和使用说明；修改 test/types.test.ts 对绘图不在历史键中的旧断言，并验证旧历史值仍可编译、缺省保留绘图而显式空 map 可清空。
- [ ] 1.2 将 useAnnotationHistory 所有权提升至 Reader 文件会话层，给两个 viewer 注入统一控制器，删除重复维护的历史状态；用 Reader 与 viewer 测试证明混合高亮／矩形／两页绘图按提交顺序回放，模式切换仍保留历史。
- [ ] 1.3 在统一快照构建／合并中保存完整不可变页 map，并用同步 ref 顺序处理连续提交；用 useAnnotationHistory 及 Reader 测试证明同一批快速两笔不丢失、旧快照不被后续编辑修改，关闭历史时绘图仍可保存。

## 2. 绘图操作提交与回放

- [ ] 2.1 接入 Reader.handlePagePaintingChange 与 PageDrawingLayer 的已提交文档，验证当前公开操作入口的提交边界；在 test/page-drawing-layer.test.tsx 和 test/painting-page-contract.test.tsx 覆盖完整 stroke／形状一项、多次 move 零项、取消和多指取消零项。记录当前没有的编辑入口，不为本任务新增工具。
- [ ] 2.2 对当前已有的对象编辑／整笔重绘、擦除、删除、页清空入口按用户事务合并通知；对每个可达入口验证一次一项、撤销精确恢复全部对象、其他页不变；空操作、仅修订变化、工具和显示变化不增加历史或保存。无法通过公开 API 满足的具体入口应报告依赖缺口。
- [ ] 2.3 实现统一 apply 的绘图回填与活跃输入取消，回放不经过新编辑提交；通过输入中撤销、原页卸载后撤销再返回、底栏与 selectionRef 一致的测试证明无幽灵笔迹或重复 checkpoint。
- [ ] 2.4 区分新编辑、回放和等值回显，避免 syncPresent / syncSilent 的 set 路径误清 future；测试撤销后新增绘图使高亮及跨页绘图 future 全部失效，新增高亮使绘图 future 失效，取消／空操作／缩放后 future 仍可重做。

## 3. 受控宿主与生命周期

- [ ] 3.1 统一受控／非受控应用和回调路由，缺少必要回填处理器时禁止移动历史并让状态与命令一致；在 test/reader.test.tsx 及两个 viewer 测试中验证完整目标回填、等值新引用回显不重复入栈、缺省 pagePaintings 兼容和显式清空。
- [ ] 3.2 修改 webview/src/ReaderSurface.tsx：drawing 来源只通知历史状态，普通绘图走既有内容保存入口；undo/redo 从完整历史目标原子更新 ranges、rects、pagePaintings；用保存链集成测试证明每次绘图提交／回放各只有一次逻辑 dataChange，ack 与回显不追加保存。
- [ ] 3.3 以文件身份／resetKey 重置历史并取消未提交手势，真实外部内容替换建立新基线；用 A/B 同 pageId、同文件外部替换、普通受控回显和模式切换测试证明不会跨文件污染或误清历史。

## 4. 集成验收与交接

- [ ] 4.1 扩充 test/annotation-snapshot-chain.test.ts 与 ReaderSurface 相应测试，验证绘图＋高亮＋矩形混合撤销／重做→一次保存→ack→重开，保留所有页面和对象属性；重开不要求保留历史栈。
- [ ] 4.2 在现有 test/browser/painting.tsx / scripts/check-painting-browser.mjs 补充实际交互验收，运行 yarn check:painting；在 EPUB／PDF Layout 及既有通用绘图路径验证鼠标／触摸输入、未挂载页回放、按钮状态；不要求 PDF Text 新增绘图。
- [ ] 4.3 运行 yarn test:run、yarn typecheck、yarn build:lib 和 yarn host:check，记录实际结果；核对 replace-pdf-painting-core 已交付接口及 V5 保存链，确保本变更没有恢复旧绘图适配或引入存储格式迁移。
