# 奖助档案平台

GitHub Pages 查询界面，配合独立的 Cloudflare 免费档案服务。无需 ChatGPT 账号，程序不调用 ChatGPT 托管服务。

平台入口：https://liuhaoyuray.github.io/scholarship-platform/

支持姓名、学号、学院、奖项及年度查询；全文定位表格行、文档段落和扫描件页码；下载独立原件；人工核验和补充登记；生成带核验依据的 Word 证明草稿及佐证 ZIP；追溯历史出具记录。申请、推荐、公示和推断年度保留原始标记，不能自动当作获奖事实。

默认只显示存在明确获奖名单、发放明细或年度资助台账依据的记录。前50%名单、资格与排名、名额测算、申请、推荐及单纯系统导入文件不计入获奖；结果公示单独待核。奖项必须能从具体文件、工作表或台账行中对应，不能由所在文件夹直接推断。过程资料保留在“显示全部档案”和学生档案的折叠区。标题判断属于资料筛选，正式证明仍需人工核验身份、奖项及年度。

## 免费部署结构

- `docs/`：实际网页，由 GitHub Actions 发布至 GitHub Pages。
- `free/worker.mjs`：原件下载、核验与证明记录接口。
- `docs/static/archive-client.mjs`：浏览器按需读取分片索引并检索档案。
- `docs/static/connection.mjs`：检测配置的数据入口，选择可访问的入口；连接失败显示可重试提示，不自动重放写入操作。
- `gateway/`：可选的免费 Pages 数据入口，通过同一 Cloudflare 账号内的服务绑定连接原档案服务，不复制学生数据。需单独部署并通过目标网络验证后才能加入网页配置。
- Workers Static Assets：存放只读索引和分片原件。原文件字节不变，下载后可验证 SHA-256。
- 小型 D1：仅存人工登记、核验及证明记录，不导入全量档案数据库。
- Word 和 ZIP 在浏览器生成，不需要服务器存放重复的证明文件。

没有开通付费方案或 R2 订阅。免费服务仍受供应商额度限制，超限时服务可能暂停；不自动升级。当前档案包控制在免费版 20,000 文件、单文件 25 MiB 限额内。ZIP/RAR 容器保留本机，已解压的独立材料提供在线查询和下载。

此公开仓库只包含程序、部署流程和虚构测试资料。学生数据、原件、生成索引、运行配置和凭据均不提交 GitHub。档案服务的访问方式由使用者自行决定；当前界面不要求另行登录。

## 检查

```text
node --test tests/*.test.mjs
python -m unittest discover -s tests -p test_award_policy.py
```

检查涵盖查询筛选、同名区分、人工补录、原件范围下载及完整性、核验变更失效、证明与历史记录。测试资料均为虚构，不会写入正式档案。

## 维护部署

需要 Node.js 22.13+、Python 3、Wrangler。复制 `free/wrangler.example.jsonc` 为被忽略的 `free/wrangler.jsonc`，填写自己的账号、D1 ID 和网页来源。

1. 在本机 `work/cloud-snapshot.sqlite3` 放置整理后的档案快照。也可用环境变量 `ARCHIVE_DB` 指向现有快照。原件路径必须可访问。
2. 设置 `ARCHIVE_WEB_ORIGIN` 为自己的 `https://用户名.github.io`，运行 `python scripts/build-free-archive.py`。分片输出在被忽略的 `work/free-assets/`，可断点继续；更换快照应使用新的构建目录，避免旧状态跳过更新。
3. 通过官方 Wrangler 登录，创建免费 D1，并运行 `wrangler d1 migrations apply scholarship-workflow --remote --config free/wrangler.jsonc`。
4. 用 `wrangler secret put ARCHIVE_SESSION_KEY --config free/wrangler.jsonc` 设置随机会话签名密钥。不要把密钥写入仓库。
5. `wrangler deploy --config free/wrangler.jsonc` 上传分片并发布接口。把实际返回的服务地址填入 `docs/config.js` 的 `apiBaseUrl`。
6. GitHub 仓库 Pages 的 Source 选择 GitHub Actions。推送 `main` 后自动发布 `docs/`；PDF.js 5.4.149 从官方 npm 恢复，并验证固定 SHA-512。

PDF.js 使用 Apache-2.0 许可，部署中保留其 LICENSE。核验及出具数据保存在 D1；日常备份应包含 D1 和本机原始档案。新增材料需要重新整理、构建和部署，不会自动扫描本机新增文件。

### 跨网络连接

网页能打开并不表示数据域名可访问。若出现连接错误，先比较 GitHub 网页与 `/archive/meta.json` 的网络连接，不能以本机已有代理时的测试代替其他电脑的直连验证。

备用入口部署：给官方 Wrangler 增加 `pages:write` 权限，创建免费 Pages 项目 `scholarship-archive-gateway`，运行 `wrangler pages deploy --config gateway/wrangler.jsonc --project-name scholarship-archive-gateway --branch main`。确认服务绑定、原件范围下载及目标网络访问正常后，将返回的正式 `pages.dev` 地址和原入口一起填入 `docs/config.js` 的 `apiBaseUrls` 数组，保留 `apiBaseUrl` 为数组内的一个地址。Pages Functions 仍受免费 Workers 请求额度限制；不同网络的可达性需要实测，不保证所有地区畅通。

参考：[Cloudflare 免费额度](https://developers.cloudflare.com/workers/platform/limits/)、[静态文件计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、[GitHub Pages](https://docs.github.com/en/pages)。
