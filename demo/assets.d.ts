// dev harness 的 vite 资产导入声明（demo/epubFoliateHarness.ts 使用）。
declare module '*.epub?url' {
  const url: string
  export default url
}

declare module '*.json?url' {
  const url: string
  export default url
}
