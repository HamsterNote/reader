# Spec Delta

## MODIFIED Requirements

### Requirement: Dev client reads bundled Web content

系统 SHALL 提供可构建安装的 iOS/Android Expo dev client；iOS 本地 PDF Layout MUST 使用 reader 仓内的原生页面渲染，PDF Text、EPUB 及 Android PDF SHALL 保留 WebView 阅读路径；必要原生及 Web 阅读资源 MUST 随应用交付。缺少原生 PDF 能力时 MUST 明确提示 dev client 构建要求，不静默降级为 Web Layout。

#### Scenario: Offline device launch
- **WHEN** 安装 dev client，启动运行所需的应用包后断开网络，用户打开本地 EPUB 和 PDF
- **THEN** 两种文件均能展示并完成高亮，不依赖外部 CDN 或开发电脑的 Web 阅读服务器；iOS PDF Layout 为原生页面，其余指定路径继续使用 Web 阅读层

#### Scenario: Missing iOS native capability
- **WHEN** iOS PDF Layout 入口未发现有效原生模块
- **THEN** 显示能力缺失及重建 dev client 的指引，不虚报 ready，不静默打开 Web Layout，已有持久化数据不变
