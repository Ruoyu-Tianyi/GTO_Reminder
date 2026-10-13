# Vercel 部署与域名配置

[返回中文 README](../README.md) · [English README](../README.en.md)

目标访问地址：`https://gto.tianyizhou.cn`。本文记录本项目的配置及需要在 DNS 控制台完成的步骤。

## 当前状态

截至 2026-10-13，Vercel 项目 `gto-reminder` 已创建，`gto.tianyizhou.cn` 已绑定至 Production，未设置重定向，域名所有权已验证。阿里云的 `gto` 解析尚未生效；生产部署访问仍待验收，因此目标域名暂不视为已上线。

| 项目 | 配置 |
| --- | --- |
| GitHub 仓库 | [Ruoyu-Tianyi/GTO_Reminder](https://github.com/Ruoyu-Tianyi/GTO_Reminder) |
| 生产分支 | `main` |
| Vercel 团队 | `Ruoyu`，团队标识 `ruoyu3` |
| Vercel 项目 | `gto-reminder` |
| 目标域名 | `gto.tianyizhou.cn`，已绑定项目，待 DNS 生效 |
| 当前 DNS 服务 | 阿里云；权威 NS 为 `dns21.hichina.com` / `dns22.hichina.com` |
| 当前 Vercel DNS 检查 | 尚未检出 CNAME / A 记录，无冲突记录；配置未生效 |

## 1. 确认 Vercel 项目与 GitHub 连接

进入 [Vercel 控制台](https://vercel.com/dashboard)，选择 **Ruoyu → gto-reminder**。在项目设置中确认已关联 `Ruoyu-Tianyi/GTO_Reminder`，生产分支为 `main`。若尚未关联，在 Git 设置中连接该仓库；若以后重新创建项目，使用 **Add New → Project → Import Git Repository**，选择同一仓库和团队。

构建配置已写入仓库根目录的 [`vercel.json`](../vercel.json)：

| 设置 | 值 |
| --- | --- |
| Framework Preset | `Vite` |
| Root Directory | 仓库根目录 `./` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment Variables | 当前静态版本无需配置 |

首次部署成功后，在 **Deployments** 打开标为 **Production / Ready** 的部署，核对提交版本，并打开 Vercel 实际分配的访问地址。不要根据项目名猜测 `vercel.app` 地址。

本项目发布网页、演示和浏览器内导入能力。`data/private/` 下的 PDF、参考转录、计算结果及迁移包不随代码部署；线上显示没有本机策略数据是预期行为。完整数据使用方式见 [README](../README.md#网页私人数据与导入)。

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
- 中英切换、范围矩阵、演示查询、收藏和 JSON 导入可用；手机宽度下能正常操作。
- Vercel 的生产部署状态为 **Ready**，关联的提交与 GitHub `main` 预期版本一致。
- 下一次正常向 `main` 推送代码后，Vercel 自动生成新的生产部署；部署成功后同一域名展示新版本。自动更新依赖 GitHub 仓库连接和生产分支配置，单次手动部署不能证明其已接通。[Vercel GitHub 集成说明](https://vercel.com/docs/git/vercel-for-github)

若提示 **Invalid Configuration**，依次核对 DNS 值是否来自本项目、`gto` 是否有冲突解析、记录是否启用及是否仍在缓存期。若 DNS 已正确但 HTTPS 未就绪，查看该域名的证书提示后处理。保留当前有效记录，避免反复改成其他项目或通用 CNAME 值。

## 日常发布

在任意开发电脑更新代码，完成测试与构建后推送 GitHub。GitHub 集成接通后，`main` 的成功构建更新生产域名；其他分支用于预览。私人数据和浏览器收藏仍按[多设备协作说明](../README.md#多设备协作)分别迁移。
