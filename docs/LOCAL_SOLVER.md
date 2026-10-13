# 本机翻前近似求解

核查及计算日期：2026-10-02 至 2026-10-13。本项目增加了原创 HTTP 包装器 `scripts/solve-local-preflop.py`，调用独立运行的 [GTOpen](https://github.com/MatthewPDingle/GTOpen) 计算策略。第三方引擎源码位于被 Git 忽略的 `.runtime/gtopen/`，没有复制进项目源码，也不随项目分发。审计版本为 `b69ea07c79884fc598757dc45c712e73976db810`；该版本未找到明确的代码再分发许可证，不能因为仓库公开就将其当作 MIT 依赖打包。

## 基础树算的是什么

这是**离散翻前树与近似后续价值模型**的计算结果，不是完整 NLHE GTO，也不是出版图表。数据使用独立的 `computed` 来源，并记录模型、迭代次数、限定树及质量状态。

- 6–9 人、所有玩家 100 BB、SB 0.5 BB / BB 1 BB、无 ante。
- 所有位置仅提供 2.5 BB 开池；3-bet 至 10 BB；最多两次加注（开池计第一次）；不开启额外 all-in 选项。
- 不允许未开池时 limp；开池后可跟注，允许冷跟与 squeeze 至同一个 10 BB 尺寸。面对 3-bet 只有跟或弃，**没有 4-bet、5-bet**。
- 5% 抽水、2.5 BB cap、no flop no drop。这里只是本地模型的明确设定，不表示其他出版范围使用相同参数。
- 169 类起手牌。数据保存每手牌的历史到达权重与条件动作频率；零 reach 是不可达，不能冒充 Fold 100%。

GTOpen 的[技术说明](https://github.com/MatthewPDingle/GTOpen/blob/b69ea07c79884fc598757dc45c712e73976db810/docs/technical_reference.md)及[平衡后续模型说明](https://github.com/MatthewPDingle/GTOpen/blob/b69ea07c79884fc598757dc45c712e73976db810/docs/preflop_balanced_model.md)明确区分了其计算模型与真实多人扑克：

- 单挑叶子使用预先采样的 169×169 权益表与 `balanced` 相对实现率。校准权重不是新训练的无抽水完整翻后解。
- 三人及以上叶子使用 `coupled_deck_v1` 的 1,024 个固定 latent-strength 样本、种子 90210。它按整个底池分配筹码，但**不是**物理 hole cards 与 board 的联合发牌；重叠紧范围的阻断误差可能很大。
- 非全下叶子结束继续下注，使用近似后续价值。没有翻牌、转牌、河牌的策略树，没有未来下注及未来抽水，也没有 ICM。
- CFR 的最佳响应差是**上述模型及固定尺寸树内部**的差值。达到 `0.02 BB/hand` 的目标不等于真实游戏 exploitability 为此数，更不代表完整多人 NLHE 已求解。

## 已计算结果

本机为 AMD Ryzen AI 9 H 365 / Radeon 880M，20 个逻辑 CPU、31.29 GiB 可见内存。引擎以 CPU 8 线程运行，arena 预算 4,096 MB，树节点上限 200,000；没有使用 NVIDIA CUDA。首次 release 编译耗时 2 分 51 秒。下表计时仅包含求解与目标检查，不包括下载、编译及 JSON 导出。

| 人数 | 固定树决策节点 | 求解轮数 | 求解耗时 | 模型最佳响应差之和（BB/hand） | 状态 |
| --- | ---: | ---: | ---: | ---: | --- |
| 6 | 607 | 30 | 4.6 秒 | 0.0184891271 | 达到模型目标 |
| 7 | 1,938 | 40 | 17.7 秒 | 0.0189930752 | 达到模型目标 |
| 8 | 6,057 | 60 | 85.0 秒 | 0.0156748421 | 达到模型目标 |
| 9 | 18,668 | 54 | 184.4 秒（两次合计） | 0.0177259849 | 达到模型目标 |

9 人首次在第 24 轮时限停止，最终快照差值未测量，所以当时保留 `null` 与未收敛状态。随后恢复同一会话，追加 63.9 秒，到第 54 轮测得上述差值并达到模型目标。更新后的数据采用最终快照同轮测量值；不能用先前轮次值替代最终快照指标，更不能把停止后返回的占位 0 当作收敛。

6 / 7 / 8 / 9 人标准快捷查询分别生成 20 / 27 / 35 / 44 个 RFI 与 Facing Open 节点，共 126 个。快捷版不提供无法表达历史 reach 的 Facing 3-bet / Facing 4-bet 数据；带 limp 选项的 RFI 仅留在完整历史版。完整历史版保留同一限定树中已计算可达的决策，各分片小于 8 MB，第一片含根节点；不同分片 ID 独立。这里的“限定树已导出”不代表其他尺寸、limp、4-bet 或翻后等未建模场景已覆盖。

初次基础树导出共 54 个树分片、4 个快捷包，包含 27,270 个唯一历史决策。所有 58 个初始包均通过项目的 `validateTreeDataset` / `validateDataset`：检查 169 类手牌、条件频率、reach、逐步历史和候选下注的合法性、分片 ID 与历史去重。续算会更新包的实际大小与质量状态；统计应读取审计文件与当前目录。这些验证只证明导出结构及下注映射合法，不证明模型接近真实游戏。

正式文件在 `data/private/*.tree.json`、`data/private/*.quick.json`；详细配置、时间、质量与覆盖记录在 `data/private/solver-audits/*.audit.json`。它们都被 Git 忽略。本轮原始未分片研究副本在 `data/private/local-computed/`。程序全量状态另存于 `.runtime/gtopen/saves/preflop/`，可供独立引擎继续研究。

### 扩展树研究结果：尚未收敛

随后计算了包含 4-bet 至 30 BB、5-bet 全下至 100 BB 的更深树。两项均在约 20 分钟时限停止，**没有达到模型目标**，包名与界面来源均明确标 `UNCONVERGED study`，不能当作前表已达到模型目标的数据。最终模型差值是 `null`；下面的旧检查点只用于研究进度，不能作为导出快照的误差。

| 模型 | 完整树总节点 / 决策 | 轮数 / 求解耗时 | 最后已测检查点（不是最终快照） | 已导出标准线决策 / Quick 节点 | 树导出大小 |
| --- | ---: | ---: | --- | ---: | ---: |
| 6 人，允许 limp，最多 4 次加注 | 539,338 / 250,270 | 39 / 1,200.8 秒 | 第 30 轮 0.4232970471 BB/hand | 200 / 15 | 3,692,756 字节，1 片 |
| 7 人，不允许 limp，最多 4 次加注 | 455,077 / 216,306 | 40 / 1,204.5 秒 | 第 30 轮 1.2734697134 BB/hand | 160 / 27 | 2,936,185 字节，1 片 |

7 人深树第 20 轮曾为 1.1579638072，第 30 轮反而升高；多人 CFR 的模型差值不保证逐轮下降，不能根据迭代数承诺收敛时间。6 人含 limp 树的隔离加注仍使用首次加注 2.5 BB，不是 4 BB；已通过引擎实际节点核对。

标准线导出采用 `heads-up-lines`：最多两名主动入池者、最多一次未加注 limp。它们来自上述完整多人求解，保留真实条件策略与 reach，不是假造的单挑残局。导出队列均已遍历完，但分别有 130 / 140 个后继分支因不属于此导出范围而省略；因此 `allReachableDecisionsExported=false`。完整 `.gtop` 存档分别约 729 MB / 615 MB，已保存，后续可以继续计算或导出其余多人分支。本轮没有导出数 GB 的全部深树 JSON。

以下是已逐历史核对的标准场景数量，`—` 表示模型未包含该场景。计数是决策节点，不是独立求解质量认证。其余导出节点含尚未入池玩家的决策、跟注与多种合法历史。

| 模型 | RFI | Facing Open | Facing 3-bet | Facing 4-bet | Facing 5-bet | BB vs SB limp | SB limp 后面对加注 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 人基础 max2 | 5 | 15 | 15 | — | — | — | — |
| 7 人基础 max2 | 6 | 21 | 21 | — | — | — | — |
| 8 人基础 max2 | 7 | 28 | 28 | — | — | — | — |
| 9 人基础 max2 | 8 | 36 | 36 | — | — | — | — |
| 6 人深树研究 max4 + limp | 5 | 15 | 15 | 15 | 15 | 1 | 1 |
| 7 人深树研究 max4 | 6 | 21 | 21 | 21 | 21 | — | — |
| 9 人深树研究 max3 | 8 | 36 | 36 | 36 | — | — | — |

2026-10-13 另补 9 人无 Limp、最多三次加注的研究树：875,521 个总节点 / 428,430 个决策，8 轮合计 554.75 秒，导出标准线 284 个决策 / 44 个 Quick 节点，完整存档 1,183,703,763 字节。追加一轮后尝试测量最终差距，但测量未在时限内完成，因此 `modelGapBb=null` 且仍标 `UNCONVERGED`。它覆盖 36 组 Facing 4-bet，但该层只允许 Fold/Call，5-bet/jam 被排除，不能解释为完整游戏只有这两种最优动作。没有导出其完整多人深树。

6 人深树覆盖工作台全部 9 个现有预设；7 人深树覆盖除两项 limp 预设外的 7 个；9 人 max3 覆盖除两项 limp 和 Facing 5-bet 外的 6 个。当前目录共 **64 个计算数据文件、27,914 个树决策、212 个 Quick 节点**，全部通过项目结构、169 手牌、条件频率、历史与候选下注合法性验证；同一模型分片没有重复历史或 ID。验证与预设匹配明细在 `data/private/solver-audits/validation-and-coverage.json`。包装器现有 18 个离线单元测试也通过。Quick 仍只导出其 v1 格式能表达的 RFI / Facing Open；深层条件策略在完整历史工作台中查看。

## 换电脑重现

需要 Python 3、Git、Rust MSVC 工具链以及 Visual Studio C++ Build Tools。先按 GTOpen 官方 README 安装其工具链，不需要安装 GPU 组件。以下从本项目目录执行；如果目录已经存在，不要再次 clone 或覆盖。

```powershell
git clone --filter=blob:none --sparse https://github.com/MatthewPDingle/GTOpen.git .runtime/gtopen
git -C .runtime/gtopen sparse-checkout set crates cache web
git -C .runtime/gtopen fetch --depth 1 origin b69ea07c79884fc598757dc45c712e73976db810
git -C .runtime/gtopen checkout --detach b69ea07c79884fc598757dc45c712e73976db810
cargo build --manifest-path .runtime/gtopen/Cargo.toml --release -p server --locked -j 4
python scripts/solve-local-preflop.py --start-server --players all --max-raises 2 --iterations 100 --seconds 120 --threads 8 --memory-mb 4096 --node-cap 200000
```

包装器只向本机 HTTP 地址发送请求。`--seconds` 是每个人数的求解时限，达到迭代上限、时限或模型目标任一条件后结束；JSON 导出额外花时间。中断快照会保留 `unfinished` / `unconverged` 与真实迭代次数；如果引擎没有测量最终快照，模型差值写为 `null`，不把 0 当作收敛。运行期间每约 10 秒输出进度。

无网络、无求解的包装器最小自测：`python scripts/test-solve-local-preflop.py`。它检查手牌索引、不可达范围、非默认全下尺寸、limp 的快捷版限制、分片与陈旧文件归档，以及非法资源参数。

`--start-server` 仅在本机端口没有服务时启动已编译引擎，Windows 下隐藏运行窗口；默认端口 3738。它不会替换已有服务的线程、内存或节点限制。需要使用不同限制时选择新端口。若已有服务正在求解，包装器拒绝覆盖它。

`--resume --players 9` 可继续同配置现有会话，会检查配置、冻结座位与对手模型，防止错误标注；`--solve-only` 先求解并保存引擎快照，暂不导出；`--export-only` 检查同配置后只导出。导出使用流式遍历与磁盘临时片，不把整树的 169 手牌字典留在内存。`--shard-mb 16` 可将大树控制在 16 MB 一片。

`--export-scope heads-up-lines` 仅导出历史中最多两名主动投入筹码的玩家、最多一次未加注 limp 的标准行动线；完整多人树照常求解，不是假设对手范围后单独求解残局。被筛掉的分支及未导出队列记录在审计里，不称为全树覆盖。默认 `full` 导出实际策略下全部可达节点，受 `--max-export-nodes` 限制。

### 重启后从存档继续（2026-10-13）

`--resume` 继续仍在内存中的会话；关闭引擎或重启电脑后，使用 `--restore-save` 加载磁盘上的 `.gtop` 再追加计算。必须重新给出与存档完全相同的人数、尺寸、limp、抽水和最大加注次数。迭代数表示本次追加的轮数，时间限制表示本次运行时间；原先总耗时与检查点会接续保留。

下面恢复已保存的 7 人 max4 无 limp 研究，在空闲的 3753 端口最多追加 5 分钟，先保存不导出。此命令只是使用示例，本轮没有执行该大树计算。随后可在同一仍运行的引擎上只导出标准线：

```powershell
python scripts/solve-local-preflop.py --start-server --url http://127.0.0.1:3753 --players 7 --max-raises 4 --restore-save .runtime/gtopen/saves/preflop/computed-7max-100bb-3211aa8e6baf.gtop --iterations 100 --seconds 300 --threads 8 --memory-mb 4096 --node-cap 1000000 --solve-only
python scripts/solve-local-preflop.py --url http://127.0.0.1:3753 --players 7 --max-raises 4 --export-only --export-scope heads-up-lines --shard-mb 16
```

恢复检查及限制：

- `--restore-save` 要求 `--start-server`，且只能选择一个人数。只能加载指定引擎目录 `saves/preflop/` 下与配置摘要完全匹配的正常 `.gtop` 文件。外部目录、符号链接、非预期文件名、截断文件、额外尾部数据、其他模型、冻结范围、玩家画像、hero 状态和 point locks 均拒绝。
- 只在包装器新启动的空进程上恢复。指定端口已有任何服务时直接拒绝，需选择未占用端口；不会调用可能中止其他求解的引擎 load API。恢复会话的实际配置、迭代和模型也会再次核对。
- 本机引擎源码必须是文档中的固定 Git revision，且源码及依赖锁文件没有修改。新保存会在 `.gtop` 旁写 `.resume.json`，记录存档字节数、SHA-256、引擎可执行文件 SHA-256、配置、迭代与质量审计。恢复要求这些记录一致；重新编译产生不同二进制摘要时拒绝恢复，不会自动绕过校验。Git revision 来自本机源码检验，二进制摘要用于保证后续使用同一构建，并不独立证明其编译来源。
- 较早没有 `.resume.json` 的存档，仅在原审计包含匹配的 engine revision、配置、最终迭代时允许迁移。会查找完整导出、`.pending` 和 `-heads-up-lines` 三类审计；这种迁移能验证配置和记录对应关系，**无法补造存档过去的字节校验记录**。本轮已验证既有存档可走此迁移路径。新侧车一旦存在但不匹配，拒绝恢复，不退回旧审计。
- 加载不会恢复引擎的最终质量测量状态。旧 gap 仅保留在历史检查点；如果只恢复再导出，最终 gap 为 `null`，仍标未确认收敛。追加计算后，仅采用新会话对最终快照测得的值。已测最终 gap 高于目标时明确标 `model target not reached`，不再与“未测最终误差”混淆。
- 保存或重新计算前也会核查已存在的同名存档，避免覆盖配置、版本或校验不符的数据。`--restore-save ... --export-only` 不重写原始 `.gtop`，仅建立恢复侧车及所请求的导出/审计文件。

换电脑续算需要自行携带 `.gtop`、对应 `.resume.json`（若已有）及原审计，并满足上述引擎检验。普通前端数据 ZIP 不包含这些大存档。仅查询已有策略无需安装或运行求解器。

验证结果：包装器现有 **18 项离线回归**通过，覆盖错误路径、配置/版本/迭代不匹配、point locks、截断与损坏存档、二进制变化、占用会话拒绝、旧误差不冒充最终误差、scoped 审计接续和限定树说明。本机另以独立临时目录验证了两条真实路径：恢复既有 6 人基础第 30 轮存档并仅导出 1 个节点，原存档字节及正式审计不变；建立 6 人 2.6 BB、max1 的微型测试树，算 1 轮后关闭引擎，再从存档启动并续算至第 2 轮，保留两轮检查点及累计耗时。仅测试进程被关闭，测试文件位于忽略的 `.runtime/`，没有加入正式数据目录。

最多三次加注的树包含面对 4-bet 的决策，但该决策只有 Fold/Call；5-bet 与额外 jam 被模型明确排除。导出来源说明会记录此边界，不能把“模型里不存在该动作”解释为真实游戏中该动作必然是 0% 或劣于跟/弃。

## 扩大树的可选实验

以下是可选的较长求解命令。本轮实际深树运行时限为 20 分钟，结果见上表；以下 30 分钟配置没有执行。单次规模和耗时取决于树、迭代与收敛，不能根据小树秒数承诺大树何时收敛。

```powershell
python scripts/solve-local-preflop.py --start-server --url http://127.0.0.1:3739 --players 7 --max-raises 4 --iterations 1000 --seconds 1800 --threads 8 --memory-mb 4096 --node-cap 3000000
```

重现本轮深树研究与标准线导出的命令如下。第一条在空闲端口建立完整树并计算；第二条只导出该同配置快照。改为 7 人无 limp 时同时移除两条命令中的 `--limp`，并将 `--players 6` 改为 `--players 7`。

```powershell
python scripts/solve-local-preflop.py --start-server --url http://127.0.0.1:3740 --players 6 --max-raises 4 --limp --iterations 2000 --seconds 1200 --threads 8 --memory-mb 4096 --node-cap 1000000 --solve-only
python scripts/solve-local-preflop.py --url http://127.0.0.1:3740 --players 6 --max-raises 4 --limp --export-only --export-scope heads-up-lines --shard-mb 16
```

同一 2.5 / 10 / 30 / 90 BB（90 达到阈值而转为全下 100 BB）的最多四次加注树，无 limp 时，预检给出 7 人 455,077 树节点、约 615 MB arena；8 人 2,685,080 树节点、约 3.63 GB arena。arena 不是进程总内存，树结构、缓存和系统还有额外占用。7 人最多三次加注的中间树实测 46.5 秒约 11 轮，最终被时限中止，不能当作收敛解。带 limp 的树更大。

默认导出上限为 50,000 个决策，允许显式调高至 1,000,000，超过时保留明确的未导出队列数量；提高上限前需考虑磁盘与浏览器内存。应用应按需载入分片，不能一次加载所有大树。大树计算仍使用相同的近似后续模型；增加迭代不会消除模型误差。

2026-10-03 补充只读预检如下，尺寸仍为 2.5 / 10 / 30 / 100 BB；arena 只计算策略与遗憾值数组，并非进程总内存。标 `>` 的项在 3,000,001 节点处截断，不能把边界当作完整规模。

| 人数 | 无 limp，最多 3 次加注：总节点 / arena MB | 有 limp，最多 3 次加注 | 无 limp，最多 4 次加注 | 有 limp，最多 4 次加注 |
| --- | ---: | ---: | ---: | ---: |
| 6 | 10,331 / 14.0 | 83,092 / 112.3 | 72,798 / 98.4 | 539,338 / 729.2 |
| 7 | 46,873 / 63.4 | 501,880 / 678.5 | 455,077 / 615.3 | >3,000,000 / >4,056 |
| 8 | 205,139 / 277.3 | 2,890,084 / 3,907.4 | 2,685,080 / 3,630.2 | >3,000,000 / >4,056 |
| 9 | 875,521 / 1,183.7 | >3,000,000 / >4,056 | >3,000,000 / >4,056 | >3,000,000 / >4,056 |

当前引擎的翻前求解 API 不支持传入某段历史、到达范围或残局 root 单独计算；节点 `path` 仅供浏览。不能把重新建立的单挑游戏当作原 7/8/9 人条件解。扩大完整树或继续迭代能改善限定模型的覆盖及误差，不能消除其后续价值模型的偏差。

## 公开数据调研的补充结论

[FreeBetRange 官方目录](https://help.freebetrange.com/Library/)列有 7-max cash 与完整翻前树，[导出文档](https://help.freebetrange.com/Export/)允许从用户自己的库导出供其他应用使用，但本轮没有登录账户或取得可批量使用的策略包。[GTO Academy 免费图表](https://gto-academy.com/charts)提供 7 / 8 人选项，其[条款](https://gto-academy.com/terms)限制复制及自动提取，因此没有抓取解库。

开源 postflop 工具不能直接补全多人翻前：[b-inary/postflop-solver](https://github.com/b-inary/postflop-solver)是翻后引擎；[chirenonhive/poker-solver](https://github.com/chirenonhive/poker-solver)目前是单挑翻前近似引擎。未发现可在本机免费取得并验证、覆盖所有实际下注历史与完整多人的全街 NLHE 求解包。
