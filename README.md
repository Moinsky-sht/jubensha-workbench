<div align="center">

# 叙事间 · jubensha-workbench

**把剧本杀从灵感写到可打印角色本的创作工作台**

界面编辑与模型修改写入同一份版本化剧本 · 十个创作空间 · 主创智能体编排

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003b57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)

</div>

---

## 这是什么

「叙事间」是一个**单用户、自部署**的剧本杀（谋杀之谜）创作工作台。它把一部长篇作品拆成
**对象**——素材、立意、设定、人物、结构、线索、正文、演绎、审校、交付十个空间共享同一批
对象——并让「人直接编辑」和「模型批量生成」走**同一条写入路径**：

- 模型的输出不是自由文本，而是受白名单约束的**变更集（ChangeSet）**；
- 变更集先在原版本上模拟，检查对象归属、引用、范围与原文一致性，再作为一个事务提交；
- 因此每次修改都可定位、可审阅、可撤销，版本冲突时保留人的稿子，不被模型覆盖。

它面向一个作者、一台自己的服务器，默认只监听 `127.0.0.1`，不提供公众注册。

## 功能

### 十个创作空间

| 空间 | 承载对象 |
| --- | --- |
| 素材 | 原始稿件、附件（TXT / Markdown / DOCX / 可提取文字的 PDF / 图片 / 音频） |
| 立意 | 核心想法、体验目标、类型与时长 |
| 设定 | 世界观规则、事件、不可违反的约束 |
| 人物 | 角色与人物关系 |
| 结构 | 幕与场景 |
| 线索 | 线索、任务、角色认知、物料 |
| 正文 | 各角色各幕的连续正文、批注 |
| 演绎 | NPC / 主持的表演脚本、进出场与话术 |
| 审校 | 问题单、试跑观察记录 |
| 交付 | 按受众与固定版本生成成品文件 |

界面按「总览 / 故事 / 资料 / 试跑 / 交付」组织，故事区分五个工作视图。

### 主创智能体

- 新建剧本时填写核心想法、题材、人数、时长，可选择生成**故事框架**、**整本初稿**或空白项目；
- 十个空间注册为有读写边界的工具，智能体按八个阶段编排；世界与人物并行、角色正文与分幕演绎并行；
- 再次运行会复用已有的简报、设定、角色、结构、线索与已覆盖目标的正文，不重复造轮子；
- 每阶段通过同一个变更事务写入，进度按「真实篇幅 / 唯一归属 / 待检查状态」统计，
  任务完成只代表本轮执行结束，不会伪称整本已经写完。

### 版本化写入与撤销

- 普通明确修改直接进草稿；锁定对象、定稿对象、版本冲突、超出范围的修改进入**审阅**；
- 每条变更记录目标、原文、范围与执行标识，重复请求幂等；
- 版本面板支持撤销 / 恢复到指定 revision，撤销会保护之后已被人工编辑的对象；
- 对象使用稳定 ID，改名不换引用；删除的对象不会再被 `@` 命中。

### 审校与交付

- **规则检查**处理可计算的问题（篇幅、覆盖度、引用、待审项）；**语义审读**调用模型，结果必须携带证据；
- 可用「有意保留」记录作者判断，避免同一问题反复出现；
- 交付按**受众**（玩家 / NPC / 主持 / 作者）与**固定版本**生成，正式导出要求定稿且没有阻断问题；
- 玩家包不含作者备注，角色文按角色与幕隔离，支持指定揭露时点。

### 模型接入与检索

| 协议 | 基地址示例 | 实际请求 |
| --- | --- | --- |
| OpenAI 兼容 | `https://服务地址/v1` | `/chat/completions` |
| OpenAI 原生 | `https://api.openai.com/v1` | `/responses` |
| Anthropic | `https://api.anthropic.com/v1` | `/messages` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | `/models/模型:streamGenerateContent?alt=sse` |

- 连接选择顺序：本次任务 → 模块 → 项目 → 全局；备用连接需显式配置；
- 四种协议均为**流式**增量传输，未完成的候选不写入正文；
- 语义检索使用 `sqlite-vec` 向量 + 原文匹配合并，失败时降级为原文匹配（单项目上限两万片段）；
- 用量在请求**前**预留，失败但用量未知的请求继续保留预留额；Token 估算使用保守字节数，
  费用是按用户配置价格计算的**估值**，不是供应商账单。

### 导入导出与打印

- 输出 Markdown、DOCX、PDF、ZIP、结构 JSON；ZIP 按人物整理正文、结构、附件与试跑记录表；
- A4 角色本、主持手册、双列线索卡通过 HTML/PDF 模板实现（Playwright Chromium 渲染）；
- DOCX 保留正文、字段、标题与分页，复杂富文本表格会转成文本；
- 扫描版 PDF 只保存原件并提示需要识别，不内置 OCR。

## 技术栈

| 层 | 选择 |
| --- | --- |
| 前端 | Vue 3.5 · Pinia · Tiptap 3 · @vue-flow · Vite 7 |
| 服务端 | Node.js 24 · Express 5 · `node:sqlite` · `sqlite-vec` · Zod 4 |
| 文档处理 | docx · mammoth · pdf-parse · pdfjs-dist · archiver |
| 渲染/打印 | Playwright（Chromium）+ noto-cjk 字体 |
| 加密 | AES-256-GCM，主密钥文件 `master.key`（0600） |

前后端同仓库，`shared/` 放两端共用的数据协议（对象、可编辑字段、操作白名单）。

## 快速开始

需要 **Node.js ≥ 24**（用到 `node:sqlite`）。

```bash
git clone https://github.com/Moinsky-sht/jubensha-workbench.git
cd jubensha-workbench

npm ci
npm run build      # vue-tsc 类型检查 + vite build
npm start          # http://127.0.0.1:4310
```

打开 `http://127.0.0.1:4310`，**首次访问会要求设置主创密码**（没有默认账号），
随后在「设置 → 模型连接」填入你自己的接口即可开始。

> 开发时用 `npm run dev`。启动进程会自动管理一个独立 Worker，**不要同时手动再起一个**。
> 停止主进程会停止 Worker；重启后中断的任务保留为「已暂停」，需要人工查看后继续。

## 配置

### 模型密钥（`.env`）

复制 `.env.example` 为 `.env`，填入自建或第三方的接口：

```bash
cp .env.example .env
# 编辑后收紧权限
chmod 600 .env
```

```ini
ARK_API_KEY=你的密钥
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_DEFAULT_MODEL=你的模型 ID

SILICON_EMBEDDING_API_KEY=你的密钥
SILICON_EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
SILICON_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
SILICON_EMBEDDING_DIMENSIONS=1024

SILICON_RERANK_API_KEY=你的密钥
SILICON_RERANK_BASE_URL=https://api.siliconflow.cn/v1
SILICON_RERANK_MODEL=Qwen/Qwen3-Reranker-8B
```

密钥只存在于服务端：浏览器不保存 API Key，导出的成品文件不含密钥，
环境文件与 `data/` 不进入镜像和公开压缩包。

### 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `4310` | 网页端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `WORKBENCH_DATA` | `data` | 持久化目录（SQLite、附件、主密钥） |
| `TRUST_PROXY` | 未启用 | 可信 HTTPS 反向代理下设 `1` |
| `NO_WORKER` | 未启用 | 分离部署 API 时设 `1` |

## 架构一览

```
浏览器 (Vue 3 / Tiptap)
   │  REST + SSE（版本、状态、增量文本）
   ▼
Express API ── ChangeSet 事务 ──► SQLite（对象 / 版本 / 任务 / 用量 / 向量）
   │                                    ▲
   │  写任务 + 冻结的规范与模型配置        │
   ▼                                    │
Worker（独立进程，全局并发 2）───────────┘
   │  协议适配：OpenAI 兼容 / OpenAI 原生 / Anthropic / Gemini
   ▼
外部模型服务（流式，预算前置预留，失败有界重试）
```

设计取舍的细节见 [`docs/architecture.md`](docs/architecture.md)，各版本的设计与验收记录在
[`docs/`](docs/)。

## 数据与安全

- 默认数据目录 `data/`（`WORKBENCH_DATA` 可改），目录权限 `0700`；
- 数据库与附件存本机 SQLite，**模型密钥使用 AES-256-GCM 加密后落库**，
  主密钥单独存于 `data/master.key`（`0600`）；
- 主密钥与数据库必须**一起备份**，否则历史密文无法解密；
- 单用户、单实例设计，不开放公众注册；对外暴露请放在 HTTPS 反向代理与鉴权之后。

## 备份与恢复

```bash
npm run backup  -- backups/2026-10-31            # SQLite 在线快照
npm run restore -- backups/2026-10-31 /data/restored
WORKBENCH_DATA=/data/restored npm start
```

恢复不覆盖既有目录，会重建附件路径、清除旧会话、暂停未完成任务。
切换正式数据目录前请先停止旧实例。

## Docker 部署

```bash
cp .env.example .env && chmod 600 .env
docker compose up -d --build
```

`compose.yaml` 默认只绑定 `127.0.0.1:4310`，数据挂载在 `./data`。
如需公网访问，请自行加反向代理（`deploy/Caddyfile.example` 是一个最小 HTTPS 示例）并
搭配鉴权；Docker 配置在本仓库只做一般性示例，未覆盖所有宿主环境。

## 开发与测试

```bash
npm run check   # vue-tsc 类型检查
npm test        # node:test 回归（隔离临时数据、本地模拟接口）
npm run build   # 生产构建
```

回归覆盖事务原子性、幂等与重复请求、撤销保护、旧版本冲突、选区边界、四种模型协议、
流式增量、任务预算与限流、项目隔离、导入、文件输出、备份恢复，以及主创智能体的工具注册、
依赖并行、已有成果复用、结构规范化与失败定位。测试不接触真实作品目录，也不调用计费接口。

两点运行说明（已在上游验证：Node 24 + Linux 下 47 项中 46 项通过）：

- 「主创阶段写入失败时显示具体步骤与可修复原因」在 v0.5 调整阶段编排后模拟接口失效，
  已显式 `skip` 并在用例内注明原因，等待按现行编排重写；
- 用例中的 `master.key` 权限断言（要求 `0600`）和 `fs.cpSync` 行为依赖 POSIX 语义，
  在 **Windows 上会失败**，请在 Linux / macOS / 容器内运行测试。

会**真实计费**的脚本单独放置、需手工执行：`scripts/provider-smoke.ts`、
`scripts/creative-smoke.ts`、`scripts/retrieval-smoke.ts`、`scripts/verify-*.ts`。

## 仓库中不包含的内容

为控制体积与隐私，本仓库不含原始部署实例的：

- `.env` 与任何真实密钥；
- `data/`（作品数据库、附件、加密主密钥）；
- `server/fixtures/archive/**/turns.jsonl`（两份个人聊天导出，约 3 MB）。
  该示例缺失时，「历史创作档案」入口会跳过并保持可用，其余功能不受影响。

`server/fixtures/new-story/` 保留了一份虚构的双人三幕示例《末班信箱》，用于「体验本」演示。

## 版本历程

| 版本 | 内容 | 文档 |
| --- | --- | --- |
| v0.1 | 对象化写作、版本化变更、事务写入、导出与打印 | [架构](docs/architecture.md) |
| v0.2 | 模型目录同步与故障切换、语义检索与重排、生成依据引用 | [v0.2-plan](docs/v0.2-plan.md) |
| v0.3 | 十个创作空间工具化，主创智能体八阶段编排 | [v0.3](docs/v0.3-agent-workflow.md) |
| v0.4 | 全局主创对话、`@` 引用任意对象、四种协议流式 | [v0.4](docs/v0.4-global-chat.md) |
| v0.5 | 总览/故事/资料/试跑/交付、连续阅读、引用节点、打印预览、体验本 | [v0.5 验收](docs/v0.5-acceptance.md) |

## 已知边界

- **JSON 模式不等于严格 Schema 保证**，模型措辞、事实与引文仍会出错，审校结果一律标为「待审」，
  不能替代人工判断；
- 角色文里的语义剧透不能只靠字段过滤识别，需要语义审读与真人试跑；
- 正文分页与实体打印效果需要主创预览并试印，自动测试不证明印刷效果；
- 试跑、竞品化的难度/数值平衡、线下实际演绎效果，均不在自动测试的证明范围内；
- 复杂诡计的逻辑完备性没有自动断言，只有可选的结构与一致性检查。

## 许可

[MIT](LICENSE)。示例剧本《末班信箱》为虚构作品，随仓库提供仅用于演示。
