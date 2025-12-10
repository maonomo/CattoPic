# CattoPic

一个自托管的图片托管服务，支持自动格式转换、标签管理和随机图片 API。基于 Next.js 前端和 Cloudflare Workers 后端构建。

[English](../README.md)

## 系统架构

```mermaid
flowchart TB
    subgraph Client["👤 客户端"]
        Browser["🌐 浏览器"]
        API_Client["📱 API 客户端"]
    end

    subgraph Vercel["Vercel"]
        NextJS["⚛️ Next.js 16<br/>React 19 + Tailwind CSS"]
    end

    subgraph Cloudflare["Cloudflare 边缘网络"]
        subgraph Worker["Worker 运行时"]
            Hono["🔥 Hono API<br/>REST 接口"]
        end

        subgraph Storage["存储层"]
            R2[("📦 R2<br/>对象存储<br/>───────────<br/>• 原始图片<br/>• WebP 版本<br/>• AVIF 版本")]
        end

        subgraph Data["数据层"]
            D1[("🗄️ D1<br/>SQLite 数据库<br/>───────────<br/>• 图片元数据<br/>• 标签<br/>• API 密钥")]
            KV[("⚡ KV<br/>键值存储<br/>───────────<br/>• 响应缓存<br/>• 速率限制")]
        end

        subgraph Async["异步处理"]
            Queue["📬 Queues<br/>───────────<br/>• 文件删除<br/>• 批量操作"]
            Cron["⏰ 定时触发器<br/>───────────<br/>• 清理过期图片<br/>• 每小时执行"]
        end

        subgraph Transform["图片处理"]
            Images["🖼️ Cloudflare Images<br/>───────────<br/>• WebP 转换<br/>• AVIF 转换<br/>• 质量优化"]
        end
    end

    Browser -->|"HTTPS"| NextJS
    NextJS -->|"API 请求"| Hono
    API_Client -->|"直接调用"| Hono

    Hono -->|"读写"| R2
    Hono -->|"查询/更新"| D1
    Hono -->|"缓存"| KV
    Hono -->|"异步任务"| Queue
    Hono -->|"图片转换"| Images

    Queue -->|"处理"| R2
    Cron -->|"触发"| Hono
    Images -->|"输出"| R2

    style Cloudflare fill:#f5f5f5,stroke:#f38020,stroke-width:2px
    style Vercel fill:#f5f5f5,stroke:#000,stroke-width:2px
    style Worker fill:#fff3e0,stroke:#f38020
    style Storage fill:#e3f2fd,stroke:#1976d2
    style Data fill:#e8f5e9,stroke:#388e3c
    style Async fill:#fce4ec,stroke:#c2185b
    style Transform fill:#f3e5f5,stroke:#7b1fa2
```

### 组件说明

| 组件 | 服务 | 用途 |
|------|------|------|
| **前端** | Vercel + Next.js | 管理界面、图片浏览、上传功能 |
| **API** | Cloudflare Worker + Hono | RESTful API、认证、请求路由 |
| **存储** | Cloudflare R2 | 存储原始图片和转换后的图片（WebP/AVIF） |
| **数据库** | Cloudflare D1 | 图片元数据、标签、API 密钥（SQLite） |
| **缓存** | Cloudflare KV | 响应缓存，减少 D1 查询 |
| **队列** | Cloudflare Queues | 异步文件删除、批量处理 |
| **图片处理** | Cloudflare Images | 实时格式转换和优化 |
| **定时任务** | Cron Triggers | 定时清理过期图片 |

## 功能特性

- **多格式支持** - 上传 JPEG、PNG、GIF、WebP、AVIF 图片
- **自动转换** - 自动生成 WebP 和 AVIF 版本以优化传输
- **标签管理** - 使用标签组织图片，支持批量操作
- **随机图片 API** - 公开 API，支持多种过滤条件
- **过期支持** - 为临时图片设置过期时间
- **现代化 UI** - 简洁的管理界面，支持深色模式

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | Next.js 16, React 19, Tailwind CSS |
| 后端 | Cloudflare Workers, Hono |
| 存储 | Cloudflare R2 |
| 数据库 | Cloudflare D1 (SQLite) |
| 缓存 | Cloudflare KV |

## 快速开始

### 前置条件

- Node.js >= 18
- [pnpm](https://pnpm.io/) 包管理器
- [Cloudflare 账户](https://dash.cloudflare.com/)
- [Vercel 账户](https://vercel.com/)（或其他静态托管服务）

### 1. 克隆并安装

```bash
git clone https://github.com/yourusername/cattopic.git
cd cattopic
pnpm install
cd worker && pnpm install
```

### 2. 创建 Cloudflare 资源

```bash
cd worker
pnpm wrangler login

# 创建 R2 存储桶
pnpm wrangler r2 bucket create cattopic-r2

# 创建 D1 数据库
pnpm wrangler d1 create CattoPic-D1
# 记录输出中的 database_id

# 创建 KV 命名空间
pnpm wrangler kv namespace create CACHE_KV
# 记录输出中的 id

# 创建队列
pnpm wrangler queues create cattopic-delete-queue

# 初始化数据库表结构
pnpm wrangler d1 execute CattoPic-D1 --remote --file=schema.sql
```

### 3. 配置 Worker

```bash
cp wrangler.example.toml wrangler.toml
```

编辑 `wrangler.toml`，填入你的资源 ID：

```toml
[vars]
R2_PUBLIC_URL = 'https://your-r2-domain.com'

[[r2_buckets]]
bucket_name = 'cattopic-r2'

[[d1_databases]]
database_name = 'CattoPic-D1'
database_id = '<你的数据库ID>'

[[kv_namespaces]]
id = "<你的KV-ID>"

[[queues.producers]]
queue = "cattopic-delete-queue"

[[queues.consumers]]
queue = "cattopic-delete-queue"
```

### 4. 部署 Worker

```bash
pnpm wrangler deploy
```

### 5. 添加 API Key

```bash
pnpm wrangler d1 execute CattoPic-D1 --remote --command "
INSERT INTO api_keys (key, created_at) VALUES ('your-secure-api-key', datetime('now'));
"
```

### 6. 部署前端

在 Vercel 配置环境变量后部署：

| 变量名 | 值 |
|--------|-----|
| `NEXT_PUBLIC_API_URL` | `https://your-worker.workers.dev` |

## API 概览

### 公开接口

#### 随机图片

```bash
GET /api/random
```

返回一张随机图片，支持过滤：

```bash
# 获取横向随机图片
curl "https://api.example.com/api/random?orientation=landscape"

# 按标签过滤
curl "https://api.example.com/api/random?tags=nature,outdoor"

# 排除标签
curl "https://api.example.com/api/random?exclude=private"

# 指定返回格式
curl "https://api.example.com/api/random?format=webp"

# 组合过滤条件
curl "https://api.example.com/api/random?orientation=portrait&tags=cat&format=avif"
```

| 参数 | 可选值 | 说明 |
|------|--------|------|
| `orientation` | `landscape`, `portrait`, `auto` | 图片方向（auto 根据 User-Agent 自动判断） |
| `tags` | 逗号分隔 | 包含所有指定标签的图片 |
| `exclude` | 逗号分隔 | 排除包含任一指定标签的图片 |
| `format` | `original`, `webp`, `avif` | 返回格式（未指定时自动协商） |

### 受保护接口

其他接口需要认证：

```bash
Authorization: Bearer <your-api-key>
```

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload/single` | 上传图片 |
| GET | `/api/images` | 获取图片列表（分页） |
| GET | `/api/images/:id` | 获取图片详情 |
| PUT | `/api/images/:id` | 更新图片元数据 |
| DELETE | `/api/images/:id` | 删除图片 |
| GET | `/api/tags` | 获取所有标签 |
| POST | `/api/tags` | 创建标签 |
| PUT | `/api/tags/:name` | 重命名标签 |
| DELETE | `/api/tags/:name` | 删除标签及关联图片 |
| POST | `/api/tags/batch` | 批量标签操作 |

## 文档

- [部署指南](../DEPLOYMENT.md)（中文）
- [部署指南](./DEPLOYMENT_EN.md)（英文）
- [API 文档](./API.md)（中文）
- [API 文档](./API_EN.md)（英文）

## 本地开发

```bash
# 终端 1：启动 Worker
cd worker
pnpm dev

# 终端 2：启动前端
pnpm dev
```

创建 `.env.local`：

```env
NEXT_PUBLIC_API_URL=http://localhost:8787
```

## 许可证

[GPL-3.0](../LICENSE)
