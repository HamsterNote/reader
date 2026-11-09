# Spec Delta

## ADDED Requirements

### Requirement: Existing page and data semantics remain compatible

系统 MUST 继续使用一基原 PDF 页号及既有 `hiddenPages` 数字 / `page-N` 公共格式，不要求宿主迁移。隐藏页在恢复确认前 MUST 保持不可导航，恢复后 SHALL 按既有页范围、裁切、标注和进度规则参与阅读；折叠入口、模态框选择及撤销本身 MUST NOT 创建标注历史或改写书签、进度、裁切和标注。

#### Scenario: Reopen historic hidden-page data

- **WHEN** 用户打开同时含数字页码和 `page-N` 的历史数据，批量恢复其中一页后保存并重开
- **THEN** 新旧标识均正确归一化，只有确认恢复的页面退出隐藏集合，其他字段与原页号语义保持不变

#### Scenario: Navigate while editing

- **WHEN** 用户在编辑态使用上一页、下一页、页码或书签定位，目标中包含仍隐藏的页面
- **THEN** 导航继续跳过仍隐藏页，不跳到折叠入口；只有已确认恢复的页面重新成为有效目标，当前可见阅读位置不因打开模态框而改变

### Requirement: Hidden page restoration preserves the latest reader data

系统 MUST 仅在确认时通过一次 `onDataChange` 原子移除所选原页的全部数字 / `page-N` 隐藏项，保留未选项、范围外项及其他最新 `ReaderData`。取消、关闭和 Escape MUST 不提交恢复。确认后 5 秒内的一次撤销 MUST 只还原确认前的隐藏页集合，合并其他最新阅读数据，不进入标注历史；受控回显不得重复提交。新隐藏或恢复、退出编辑、外部替换隐藏集合或切书 MUST 使旧撤销失效。

#### Scenario: Confirm aliases and preserve unrelated entries

- **WHEN** 当前隐藏数据同时包含 `4`、`page-4`、未选页及范围外项，用户选择第 4 页并确认
- **THEN** 仅发出一次数据更新，移除 `4` 与 `page-4`，其余隐藏项保持原顺序，最新书签、进度、裁切和标注保持不变，宿主回显不产生第二次恢复

#### Scenario: Undo after another reader field changes

- **WHEN** 恢复确认后宿主更新其他阅读字段，用户在 5 秒内撤销恢复
- **THEN** 确认前的隐藏页集合被恢复一次，其他字段保留最新值，不覆盖宿主更新，也不增加标注历史

#### Scenario: Expired or replaced restoration session

- **WHEN** 确认已超过 5 秒，或发生新的隐藏/恢复、退出编辑、外部替换隐藏集合或切换文档
- **THEN** 旧撤销不可用，迟到操作不得覆盖当前文档的隐藏页或其他阅读数据
