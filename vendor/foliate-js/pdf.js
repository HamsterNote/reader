// reader 自有桩（非上游文件）：foliate-js 的实验性 PDF 后端不带入本仓库
// —— 它静态依赖未随附的 pdfjs 构建产物，且本项目 PDF 主线（HAM-89）使用
// pdfjs-dist 官方 viewer，不经过 foliate。view.js 的动态 import 仅在打开
// PDF 时触发；打开 PDF 时报错比静默失败更诚实。

export const makePDF = () => {
  throw new Error(
    'foliate-js PDF backend is not vendored; use the pdfjs-dist viewer pipeline'
  )
}
