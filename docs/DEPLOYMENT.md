# Vercel 部署与域名配置

[返回中文 README](../README.md) · [English README](../README.en.md)

当前在线地址：[gto-reminder.vercel.app](https://gto-reminder.vercel.app)。正式域名 `https://gto.tianyizhou.cn` 已绑定项目，待 DNS 解析生效。本文记录已完成配置及剩余的人工解析步骤。

## 当前状态

首次自动发布记录：2026-10-13，GitHub `main` 的 [`e16aae0`](https://github.com/Ruoyu-Tianyi/GTO_Reminder/commit/e16aae05b9ece9deb0a25af26a9cd5f60ab09174) 触发 Vercel 生产部署并达到 **Ready**，通过未登录浏览器访问验收，正确显示“若瑜策略研究”及完整界面。该记录证明自动发布已接通，不代表后续静态数据快照已经完成上线验收。最新版本以 GitHub `main` 及 Vercel 对应的成功生产部署为准。

`gto.tianyizhou.cn` 已绑定并指向生产部署，未设置重定向，域名所有权已验证。剩余工作是阿里云的 `gto` 解析及正式域名 HTTPS 验收；目前可直接使用上方 Vercel 在线地址。

| 项目 | 配置 |
| --- | --- |
| GitHub 仓库 | [Ruoyu-Tianyi/GTO_Reminder](https://github.com/Ruoyu-Tianyi/GTO_Reminder) |
| 生产分支 | `main` |
| Vercel 团队 | `Ruoyu`，团队标识 `ruoyu3` |
| Vercel 项目 | `gto-reminder` |
| 已上线地址 | [https://gto-reminder.vercel.app](https://gto-reminder.vercel.app) |
| GitHub 自动发布 | 已验证：`main` 推送触发生产部署 |
| 目标域名 | `gto.tianyizhou.cn`，已绑定项目，待 DNS 生效 |
| 当前 DNS 服务 | 阿里云；权威 NS 为 `dns21.hichina.com` / `dns22.hichina.com` |
| 当前 Vercel DNS 检查 | 尚未检出 CNAME / A 记录，无冲突记录；配置未生效 |

## 1. 确认 Vercel 项目与 GitHub 连接

本项目已关联 `Ruoyu-Tianyi/GTO_Reminder`，生产分支为 `main`，自动发布已经验证。可进入 [Vercel 控制台](https://vercel.com/dashboard)，选择 **Ruoyu → gto-reminder** 查看。若以后重新创建项目，使用 **Add New → Project → Import Git Repository**，选择同一仓库和团队。

构建配置已写入仓库根目录的 [`vercel.json`](../vercel.json)：

| 设置 | 值 |
| --- | --- |
| Framework Preset | `Vite` |
| Root Directory | 仓库根目录 `./` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 当前部署为 `24.x` |
| Environment Variables | 全静态版本无需配置，无登录及 Supabase 依赖 |

后续发布时，在 **Deployments** 打开标为 **Production / Ready** 的部署，核对提交版本，并访问 [gto-reminder.vercel.app](https://gto-reminder.vercel.app) 检查更新。

本项目采用全静态架构。生产构建发布网页及 `public/strategy-library/` 中选定的业务数据快照：434 类场景、325 个参考场景、11 个模型、29,425 个完整历史决策，以及列入白名单的原 PDF。压缩分片按需加载，gzip 策略数据约 19.3 MiB，3 份 PDF 约 52.3 MiB，发布包合计约 71.6 MiB。原 PDF 仅在打开时载入，首屏不会下载整库。

`data/private/` 仍是本机工作目录，整体不会公开。导出流程只读取指定业务文件，排除运行日志、求解 checkpoints、审计文件、迁移 ZIP 和其他工作文件。开发环境优先读取本地数据 API，生产环境读取已发布的静态快照。内置策略可跨设备直接查阅；手动导入仍只保存在页面会话，收藏仍在浏览器本地通过导入、导出迁移。详见 [README](../README.md#公开策略库与本地数据)。

## 2. 在 Vercel 绑定域名

本项目已经完成绑定，可直接打开[项目域名设置](https://vercel.com/ruoyu3/gto-reminder/settings/domains)，检查 `gto.tianyizhou.cn` 的状态。若以后重新绑定，进入 **Settings → Domains → Add Domain**，输入该域名，连接到 **Production**，不设置跳转。域名应直接承载本项目的生产版本。[官方环境绑定说明](https://vercel.com/docs/domains/working-with-domains/add-a-domain-to-environment)

展开该域名的 DNS 配置提示，复制项目给出的 **CNAME 记录值**。本次从已绑定项目读取到的推荐值为 `cname.vercel-dns.com.`；以后以该页面的最新提示为准，不套用其他项目或网上示例的值。[官方添加域名说明](https://vercel.com/docs/domains/working-with-domains/add-a-domain)

本次应填写的解析值：

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| CNAME | `gto` | `cname.vercel-dns.com`（末尾加 `.` 也可） |
| 所有权 TXT | 本次不需要 | 域名所有权已验证 |

## 3. 在阿里云添加解析

登录管理 `tianyizhou.cn` 的阿里云账号，进入 **云解析 DNS → 域名解析 → tianyizhou.cn → 解析设置 → 添加记录**，填写：

| 字段 | 填写内容 |
| --- | --- |
| 记录类型 | `CNAME` |
| 主机记录 | `gto` |
| 解析请求来源 / 线路 | 默认 |
| 记录值 | `cname.vercel-dns.com`；不加 `https://` 或路径，以 Vercel 最新提示为准 |
| TTL | 600 秒（10 分钟），或控制台默认值 |
| 状态 | 启用 |

阿里云会自动追加根域，因此主机记录填写 `gto`。如果已有同名解析，先核对其用途；只调整本次 `gto` 的冲突记录。根域 `@`、`www`、MX、现有验证 TXT 和 NS 均保持原样。[阿里云添加解析记录说明](https://www.alibabacloud.com/help/en/dns/pubz-add-parsing-record)

如果 Vercel 要求所有权 TXT 验证，另外添加其指定记录；当提示给的是完整域名时，按阿里云表单换成相对于 `tianyizhou.cn` 的主机记录，避免重复后缀。此项只在 Vercel 实际要求时执行。无需将域名注册商或 NS 迁移至 Vercel。

## 4. 检查生效与 HTTPS

保存解析后，回到 Vercel 的 **Domains** 页面刷新检查。DNS 缓存需要传播时间；以页面显示 **Valid Configuration**、HTTPS 证书正常和实际浏览器访问成功为完成标准。

人工验收：

- 打开 `https://gto.tianyizhou.cn`，地址保持该域名，页面标题为“若瑜策略研究”，浏览器无证书警告。
- 中英切换、范围矩阵、内置策略查询、收藏和 JSON 导入可用；手机宽度下能正常操作。
- Vercel 的生产部署状态为 **Ready**，关联的提交与 GitHub `main` 预期版本一致。
- GitHub 自动生产部署已经验证；以后正常向 `main` 推送代码时，检查新部署对应同一提交，并在成功后确认域名展示新版本。[Vercel GitHub 集成说明](https://vercel.com/docs/git/vercel-for-github)

若提示 **Invalid Configuration**，依次核对 DNS 值是否来自本项目、`gto` 是否有冲突解析、记录是否启用及是否仍在缓存期。若 DNS 已正确但 HTTPS 未就绪，查看该域名的证书提示后处理。保留当前有效记录，避免反复改成其他项目或通用 CNAME 值。

## 日常发布与数据更新

仅修改界面或代码时，构建后将变更推送 GitHub。现已接通的集成会自动将 `main` 的成功构建发布至生产站点；其他分支用于预览。正式域名解析生效后也会跟随生产更新。

更新内置策略时，先在持有源数据的电脑完成转录或计算，再执行以下发布流程：

1. 在仓库根目录运行 `npm run export:library`，将选定数据生成至 `public/strategy-library/`。根目录的 `manifest.json` 记录当前快照，带内容哈希的压缩分片、索引和 PDF 位于 `assets/`。原始工作目录不直接加入部署。
2. 一起提交生成的索引、压缩分片和白名单 PDF，使目录与数据保持同一快照；本机新计算不会自动改变线上结果。
3. 构建并推送至 GitHub `main`，等待对应 Vercel 生产部署成功。需要人工核验时，从网站打开更新后的来源，确认版本与来源信息。

导出统计保存在本机 `.runtime/static-library-export.json`，不公开发布。Vercel 构建使用仓库中提交的快照，不需要登录、数据库连接或 Supabase 项目。开发工作数据和浏览器收藏仍按[多设备协作说明](../README.md#多设备协作)分别迁移；普通使用者换设备只需打开网站。
