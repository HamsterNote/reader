# 高亮拖动交接

可选 `ReaderProps.highlightDragHandoff` 启用 `pane-highlight-drag-v1`。不传时保留原 `onDragHighlight(range)`；协商后优先新接口，旧回调不双发。PDF Layout/Text、EPUB 共用该接口。reader 不实现文件身份、分栏判定或 HNN 载体。

权威契约：WebBase `openspec/changes/add-pane-highlight-drag-handoff/contracts/highlight-handoff.md`。本库仅公开其中的库内 `ReaderHighlightGesture`，宿主 adapter 补充 runtime 身份和桥接包络。

```tsx
const highlightDragHandoff: ReaderHighlightDragHandoff = {
  contract: 'pane-highlight-drag-v1',
  onGesture(gesture, acknowledge) {
    // start 时匹配已经从 pointer/touch down 预观察的同一连续触点。
    // 不可在收到 start 后等待下一次按下。
    host.handleGesture(gesture, acknowledge)
  }
}
<Reader highlightDragHandoff={highlightDragHandoff} />
```

只有 start 的 acknowledge 有效，宿主保留它：匹配成功后回复 `accepted`，释放 owner 后回复 `ended`；拒绝用 `rejected`。函数闭包绑定本次 gesture，迟到确认无法复活旧会话。宿主须对拒绝/超时显示可见反馈。确认前 reader 输出 move/end/cancel，接管后不输出权威 move/end；原高亮完整对象未经重造地发送，附加字段保留。

触摸保留 500ms 长按和各轴 4px 容差，鼠标主键移动超过 4px 激活，pen 不扩展。`HIGHLIGHT_HANDOFF_TIMEOUT_MS = 250` 为长按成功后的接管等待上限，超过即取消、释放输入抑制。250ms 是经评审批准的初始响应预算：为异步桥接和宿主匹配留出时间，又将无响应等待限制在四分之一秒内；不把它描述为设备性能实测结论。

验证：`yarn typecheck`、`yarn test:run`、`yarn build:lib`；`node scripts/check-highlight-handoff.mjs` 通过真实 PDF.js/Foliate DOM 与 CDP 触摸验证原始范围、新旧接口优先级和无 ghost。此脚本中宿主确认是测试 callback，仅证明库级交接，不证明 native 渲染或跨栏链路。
