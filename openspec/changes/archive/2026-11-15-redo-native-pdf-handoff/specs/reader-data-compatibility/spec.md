# Spec Delta

## ADDED Requirements

### Requirement: Handoff edits preserve immutable operation intent

系统 MUST 为每次已接受提交固定该操作自己的不可变基线快照、目标值、身份及逐字段修改标记，prepare 和所有保存重试不得读取后续编辑器可变状态重新决定操作意图。每次尝试 SHALL 从最新权威事务快照保留未修改字段，仅应用该操作真正修改的字段；缺省、未修改和用户明确清空 MUST 可区分。运行时操作元信息不得改变既有公共存储格式。

#### Scenario: Crop follows a retiring Web hidden page write
- **WHEN** Web 隐藏原页 2 正在保存，用户切原生，交接完成后仅提交全局上边裁切 5%，然后重开
- **THEN** hiddenPages 仍包含 2，edgeCrop.all.top 为 0.05，无关标注、单页裁切、评论、书签和有效进度均不被旧基线覆盖

#### Scenario: Retry after reopening and cancelling the editor
- **WHEN** 只修改裁切的操作基线隐藏页为空，首次保存失败；权威数据已有 hiddenPages=[2]，用户再次打开编辑器、不修改并取消，再重试原操作
- **THEN** 原操作的基线、字段修改标记及目标不变，裁切保存为 5%，hiddenPages 保持 [2]；不能把未动隐藏页误判成主动清空

#### Scenario: Explicit clear and unchanged fields differ
- **WHEN** 用户明确恢复全部隐藏页，或仅修改裁切但完全未动隐藏页
- **THEN** 前者保存明确空隐藏集合，后者保留最新权威隐藏值及既有数字/page-N 语义；全局裁切编辑保留最新单页裁切，未知信封字段保持不变

#### Scenario: Transaction baseline changes after preparation
- **WHEN** 操作准备完成后、原子写入执行前，权威数据的未修改字段已更新
- **THEN** 写入使用事务执行时的最新字段，不使用准备时缓存整份数据覆盖它们；后续草稿修改也不改变已接受操作

### Requirement: Failed handoff operations remain ordered and recoverable

系统 MUST 保留每个未确认操作及其原意图，后续编辑或失败不得替换旧待重试操作。重试 SHALL 按已接受顺序执行，每个操作最多形成一次逻辑保存与历史项，保存确认后才清除错误并允许退出。页面编辑撤销 MUST 仅还原该操作实际改过的字段，不能借旧撤销基线覆盖未修改字段。

#### Scenario: A later edit does not replace a failed save
- **WHEN** 一个裁切操作保存失败，用户打开新编辑器或尝试另一提交，再点击保存重试
- **THEN** 旧裁切操作仍可完成，新操作不能覆盖其重试数据；重复点击重试不产生重复逻辑写入/历史，最终重开同时保留所有成功提交的意图

#### Scenario: Crop only undo preserves latest hidden pages
- **WHEN** 仅裁切操作成功保存后，用户在既有撤销时间窗内撤销
- **THEN** 只恢复裁切前值，当前 hiddenPages、标注与其他未修改字段保持最新值；失败操作不宣称已保存或开启已保存撤销时限
