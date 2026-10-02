# chatgpt-web

这是一个基于 [Next.js](https://nextjs.org/) 和 React 的 LLM Market 用户端。原项目由 [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app) 初始化，当前页面包含登录、对话、余额充值及个人中心等功能。

## 技术依赖

- Node.js 与 npm：仓库未在 `package.json` 中锁定 Node.js 版本；请使用能够安装当前 lockfile 的 Node.js/npm 组合。
- Next.js `^13.4.13`、React `18.2.0`、TypeScript `5.0.4`。
- Ant Design `^5.6.1`、Sass `^1.62.1`、Tailwind CSS `3.3.2`、Zustand `^4.3.6`。
- `next.config.js` 启用 standalone 输出并配置 SVG webpack loader；当前没有 Next.js rewrites 或 API 代理。

## 环境变量

仓库提供 `.env.example`，不包含密钥：

```dotenv
NEXT_PUBLIC_API_HOST_URL=http://127.0.0.1:8093
```

本地安装依赖后复制为 `.env.local`，再按实际后端地址修改：

```bash
npm install
cp .env.example .env.local
```

`NEXT_PUBLIC_API_HOST_URL` 会被客户端代码使用，必须在构建前设置。它覆盖 `src/apis/index.tsx` 和 `src/apis/account-balance.ts` 中的默认地址 `http://127.0.0.1:8093`，用于登录、模型列表、对话、账户、商品和支付订单接口。

## 后端依赖与 API 地址

前端不是独立可用的静态页面，需要后端接口和浏览器可访问的跨域配置：

| 用途 | 地址来源 | 默认地址 |
| --- | --- | --- |
| 登录、模型、对话、账户、余额充值 | `NEXT_PUBLIC_API_HOST_URL` | `http://127.0.0.1:8093` |
| 抽奖、活动及大市场接口 | `src/apis/index.tsx` 中的固定常量 | `http://127.0.0.1:8098` |

主要接口路径包括 `/api/v1/auth/*`、`/api/v1/chatgpt/models`、`/api/v1/chatgpt/chat/completions`、`/api/v1/account/*`、`/api/v1/sale/*` 和 `/api/v1/raffle/*`。其中 `8098` 目前没有对应的前端环境变量；生产环境不能把该地址保留为 `127.0.0.1`，应在发布前改为浏览器可访问的后端地址，或先完成统一反向代理/配置化改造。

由于 `next.config.js` 没有 rewrites/proxy，生产部署还需要让后端允许实际前端来源的 CORS 请求，或在网关层配置反向代理。Authorization 请求头由登录态在浏览器运行时注入，不要把访问令牌写入 README、`.env.example` 或构建产物。

## 本地开发

```bash
npm run dev
```

开发脚本固定使用 Next.js `3003` 端口，访问 <http://127.0.0.1:3003>。如端口已被占用，请先调整 `package.json` 中的脚本或通过项目现有运行方式处理，不要假设后端端口可以替代前端端口。

## 构建、检查与启动

```bash
# 代码风格检查
npm run lint

# 生产构建
npm run build

# 启动已构建的应用
npm run start
```

`npm run start` 使用 `next start --port 3003`，因此生产进程默认监听 `3003`。部署到 Nginx、Ingress 或其他网关时，请将该端口映射到外部域名，并同时配置后端 API 的 CORS 或同源代理。`NEXT_PUBLIC_API_HOST_URL` 是公开前端配置，不应放置任何真实密钥。

## 原始来源与许可证信息

- 项目基础来源：[Next.js](https://nextjs.org/)、[Next.js GitHub](https://github.com/vercel/next.js/) 和 [Learn Next.js](https://nextjs.org/learn)。
- 部署参考：[Vercel deployment](https://vercel.com/new?utm_source=create-next-app&utm_medium=default-template&filter=next.js)。
- `package.json` 当前声明的许可证字段为 `XiaoFuGe`；本文不替换或重新解释该声明，使用和再发布前请遵循仓库实际授权约定。
- 保留原项目资料：[TypeScript 教程](https://www.runoob.com/typescript/ts-tutorial.html)；[ico 制作工具](https://www.51tool.com/ico/?action=make)。
