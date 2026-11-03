# Spec Delta

## MODIFIED Requirements

### Requirement: Persisted annotation round trip
系统 MUST 读取现有 v2/v3/v4 高亮数据，保留范围、矩形、绘图及其稳定 ID、createdAt（若源数据具有）、端点、坐标单位、样式和评论关联。升级后系统 MUST 只向新的版本化存储键写入新格式，绘图内容使用新版 EditorDocument；首次打开只有旧数据的文件时 SHALL 调用 painting 提供的一次性迁移能力，而非在 reader 内映射旧笔迹。原始旧 blob MUST 原样保留，后续新增、编辑、删除、清空、导入及导出均不得改写、投影或删除该 blob。运行时专有定位标识、显示变换及派生渲染缓存不得泄露到标注的公共持久化数据。

#### Scenario: Read legacy and write current data
- **WHEN** 同一文件首次加载合法 v2、v3 或 v4 历史样本，新键不存在
- **THEN** 范围和矩形按既有规则恢复，绘图交由库迁移，新格式落入独立键；旧 blob 字节内容保持不变，源标注位置、样式、顺序及关联保持一致；v2/v3 缺少绘图时产生空的新绘图集合

#### Scenario: New annotations use the new authoritative format
- **WHEN** 在升级后创建跨页高亮、矩形或绘图并保存，再由新版重开
- **THEN** 从新键恢复最新数据，使用稳定公开页面 ID；仅新键被更新，原旧 blob 不变，旧版只能显示升级前状态而不会获得新增标注

#### Scenario: New annotations remain backward readable
- **WHEN** 升级后创建跨页高亮、矩形或绘图并保存，然后使用旧版读入器打开同一文件的旧记录
- **THEN** 旧读入器仍能读取未被修改的升级前 v4 数据，但不再保证读到新增标注；新增标注只在新版新键中恢复，此场景的旧版可读保证明确收窄为升级前快照可读

### Requirement: Existing consumers and formats remain usable
系统 SHALL 保留既有 Web 库入口、style.css、非绘图公开数据与回调语义，以及非 EPUB/PDF 文档的原有阅读路径。绘图公开类型和回调负载 MUST 统一为新版文档与控制模型，调用方 SHALL 按版本升级说明迁移，不再承诺旧 DrawingValue 类型和旧控制器 API 兼容。所有共享绘图层消费者 MUST 在同一 change 内转用新版绘图能力；reader 不得保留旧绘图组件、旧模型适配实现或旧渲染兜底。

#### Scenario: Existing Web consumer imports the library
- **WHEN** 既有消费者导入库入口和 style.css，并按新版绘图契约更新绘图参数和回调
- **THEN** 能构建、显示并接收新文档回调；非绘图参数与回调保持原有语义，不要求传入引擎私有定位标识

#### Scenario: Other formats are opened
- **WHEN** 打开基线支持的 EPUB、TXT、Markdown、DOCX 或图片并使用适用的绘图或页面预览能力
- **THEN** 继续使用原有可用阅读与标注行为，绘图及预览均走同一新版路径，无旧组件或悬空旧 API 引用

## ADDED Requirements

### Requirement: New format recovery and migration are idempotent
系统 MUST 以完整、有效的新键为唯一权威数据源。仅新键不存在时可启动旧数据迁移；空绘图集合也属于有效的新数据。迁移 SHALL 按文件完成一次完整写入，失败不得留下可被视为成功的新数据。重复打开、重试或重复消息 MUST 不重复创建笔迹或改变稳定 ID。新键损坏或版本不支持时 MUST 明确提示恢复错误并保留原数据，不得自动退回旧 blob 后覆盖新数据。

#### Scenario: Reopen or retry an interrupted migration
- **WHEN** 同一旧文件重复打开，或在新键提交前失败后重试迁移
- **THEN** 成功后得到同一组稳定笔迹 ID、样式及页面坐标，无重复对象；原旧 blob 不变，不出现半页迁移成功的混合状态

#### Scenario: Deleted drawings never reappear
- **WHEN** 用户完成迁移后删除该页全部笔迹或清空全部标注，保存并重开
- **THEN** 有效新键中的空集合被恢复，不再用旧 blob 补齐或迁移，已删除笔迹不复活

#### Scenario: Corrupt or unsupported new data is encountered
- **WHEN** 新键存在但 JSON 损坏、文档校验失败或格式版本不受支持
- **THEN** 提示可重试或显式恢复的错误，既不将其当成新键缺失，也不静默回退、清空或覆盖任何已存数据

#### Scenario: A legacy object cannot be migrated
- **WHEN** painting 返回某个历史绘图无法迁移或不能保证保真
- **THEN** reader 显示明确失败结果，停止该文件的迁移提交并保留旧数据；不得自行补写旧模型映射或静默丢弃该对象

### Requirement: Reader delegates drawing compatibility to the published library
reader MUST 仅调用正式发布绘图库的迁移能力和页面锚定能力；对旧绘图类型的识别、对象映射、迁移版本处理和绘图坐标投影 MUST 由库负责。reader 可执行新旧存储键选择、读取旧容器并将绘图原值传入迁移 API，以及处理成功/失败结果，但不得包含旧笔迹模型分支、反向投影、降级双写或对不同 PDF 变换的自定义绘图换算。

#### Scenario: Integrate the released drawing capabilities
- **WHEN** 审查 reader 最终依赖与调用路径，并使用旧格式样本打开 PDF
- **THEN** 依赖为正式发布的确定版本，无 git ref、file/link/workspace 替代；reader 直接消费库的迁移结果和页锚定能力，源码与构建产物均无旧绘图实现兜底
