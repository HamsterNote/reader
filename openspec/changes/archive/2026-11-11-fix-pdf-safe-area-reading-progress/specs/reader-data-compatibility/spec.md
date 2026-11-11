# Spec Delta

## MODIFIED Requirements

### Requirement: Viewport content determines persisted reading position
系统 MUST 以实际正文安全视口确定进度；已确认页面几何的 PDF Layout 续读 MUST 始终保存安全视口上边界线所在原页及其页内纵向百分比，不依赖文字提取或吸附到文字。以下文字优先规则仅适用于 EPUB、PDF Text 及 PDF 模式互切：视口内有可定位非空白文字时 SHALL 锚定最上方可见行的首个可见源字符，包括部分可见行；同一行按既有阅读顺序判定。仅当文字提取已完成且视口无可定位文字时，系统 MUST 保存目标页及视口顶端在该页中的纵向百分比；不得使用全书滚动比例或选取视口之外的文字。页面几何尚未就绪、零尺寸或加载失败 MUST 保留最后稳定位置，不视为无文字；需要文字定位的路径在文字映射尚未就绪时亦 MUST 保留最后稳定位置。

#### Scenario: Image above visible text
- **WHEN** EPUB、PDF Text 或 PDF 模式互切的安全视口顶部是图片，下部有一行可定位文字
- **THEN** 保存该行首个可见源字符，不保存图片比例或页面首字

#### Scenario: No text inside a mixed page viewport
- **WHEN** 视口仅展示文字页面中的插图/空白区域，其他文字位于视口外
- **THEN** 保存目标页及 clamp((视口顶端 - 显示页顶端) / 显示页高度 * 100, 0, 100)，页间距不计入页高度；分页逻辑页使用按阅读顺序纵向展开后的片段累计内容坐标和总高度；视口顶端位于页间隙时选择视口内下一允许页面

#### Scenario: Loading is not an empty viewport
- **WHEN** 重开时目标页几何尚未就绪、目标加载失败，或需要文字定位时文字映射尚未就绪
- **THEN** 已保存进度不被临时页首、空值或比例 0 覆盖

#### Scenario: PDF layout with visible text persists a geometric position
- **WHEN** PDF Layout 安全上边界线处于原页 35%，同一安全视口最上方文字位于该页 48%
- **THEN** 续读记录是该原页及 35% 而非文字锚点；文字层尚未完成不妨碍已就绪页面几何的采集，互切仍以 48% 所在源文字为优先目标


### Requirement: Reading progress remains incrementally backward compatible
系统 SHALL 继续读取已有 Layout 文字/百分比书签、Text 页码/文字进度以及旧布局变换。当前模式的有效进度 MUST 优先于旧变换锚点；Text 无 anchor 时 SHALL 使用可选页内比例，缺少比例的旧页码 SHALL 恢复页首。系统 MUST 保持原有信封字段优先级、存储键和旧原件；新比例仅作可选字段扩展，不能要求批量迁移。恢复读取不得自行回写降级位置或丢弃无关标注和阅读配置。PDF Layout 历史文字进度 SHALL 继续按安全区文字定位读取，仅在用户后续有效导航或阅读移动后改写为当前安全线比例；新比例 MUST 不改变文字书签或高亮导航的锚点语义。

#### Scenario: Legacy progress samples are reopened
- **WHEN** 分别打开仅有 layoutReadingProgress、仅有 textReadingProgress.currentPageNumber、仅有 virtualPaper.anchor 或旧布局 x/y/scale 的记录
- **THEN** 前三者按当前模式及既有回退语义恢复，纯变换在支持该变换的原布局继续恢复；不伪造缺失精度，用户有效移动后才写当前进度

#### Scenario: Current and legacy positions disagree
- **WHEN** Layout 同时存在有效 layoutReadingProgress 和不同位置的 virtualPaper.anchor，或信封 readerData 与独立 progress 包含同名字段
- **THEN** 前者使用 layoutReadingProgress，后者沿用 readerData 同名字段优先，重复打开结果一致

#### Scenario: Invalid or unavailable historic anchor
- **WHEN** 历史锚点在目标加载完成后仍不能定位，或比例不是有限数值
- **THEN** 采用同记录有效比例或有效源页页首作显示回退，提示不能精确恢复并保留原记录；无任何有效位置才显示默认首个可读页，不绑定到相似文字；有限越界比例夹至 0..100

#### Scenario: Save progress alongside another edit
- **WHEN** 进度等待提交期间用户新增高亮、绘图或书签，然后进度被保存并重开
- **THEN** 最新进度与最新已提交编辑均被保留，未改模式的进度和其他阅读配置不被旧快照覆盖

#### Scenario: Legacy PDF text progress upgrades only after navigation
- **WHEN** 打开仅有 PDF Layout 文字进度的旧记录，等待恢复而不操作，然后主动滚动并保存重开
- **THEN** 初次读取按旧文字定位且不自动回写；有效滚动后记录安全线页内比例，重开按比例恢复，无关数据保留
