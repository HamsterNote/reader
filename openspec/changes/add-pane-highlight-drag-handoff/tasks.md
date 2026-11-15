# Tasks

## 1. 可选交接 API

- [x] 1.1 依据WebBase同名change唯一契约增加可选公开交接接口/类型导出与能力判定，保留旧 `onDragHighlight(range)`；通过 `yarn typecheck` 与类型消费夹具，确认无宿主路径/载体私有副本。
- [x] 1.2 在Reader与viewer之间传递回调和接管确认，已协商新路径时只输出一次，保留原range全部字段；通过 `yarn test:run` 覆盖PDF Layout/Text、EPUB、旧新回调同时传入和JSON序列化。

## 2. 输入生命周期

- [x] 2.1 将整个已确认高亮的新路径从multi-drag tracker改为原生pointer观察，保留500ms/4px及鼠标策略，不创建tracker/ghost；通过 `yarn test:run` 检查激活、提前移动/抬起与多指取消，其他multi-drag使用者不受影响。
- [x] 2.2 实现确认前move/end/cancel与accepted后的owner切换，超时/拒绝/旧确认不复活；通过 `yarn test:run` 的延迟与取消用例，接管后不重复发送权威移动或终结。
- [x] 2.3 统一取消、blur、切文档/模式、卸载的计时器/监听/selection抑制清理；通过浏览器连续切换20次和再次复制/滚动检查，无遗留输入锁或旧文档更新。

## 3. 回归与跨仓交接

- [x] 3.1 使用 `yarn typecheck`、`yarn test:run`、`yarn build:lib` 及已有 `yarn check:web-selection` / `yarn check:browser` 做Web回归，验证单栏长按、复制、标注、端点与放大镜；失败保留原始记录并修复，不以接口单测代替真实DOM。
- [x] 3.2 将真实构建包与版本交给WebBase集成，按主change的 `smoke-tests.md` AC1/2/6验证全树无ghost、原始范围一致和单栏不回退；由WebBase接线删除其旧portal和第二层tracker，不在reader仓修改宿主源码。
- [x] 3.3 交付实际包版本、构建/回归结果与共同夹具的一致性证据；开发时验收为Web-only，跨栏完整六项归WebBase，native成败不阻塞Web开发完成，未运行的设备专项明确标注。

已按批准进入实现并以 tag workflow 发布 3.0.4；以上勾选仅代表库与 Web 集成验证，native AC1 仍待人类真机验收。

执行记录：`evidence/validation.md`（命令、原始输出、环境与时间）；完整日志另随 issue 证据附件交付。
