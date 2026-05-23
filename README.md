# follow

follow 是一个自动同步来源的追更小工具。它以平台为入口，帮助你关联 YouTube、手动添加小红书/微博博主，或添加 RSS 订阅源，并集中查看关注对象的最新更新。

## 本地运行

```bash
npm install
npm run dev
```

默认本地地址为 Vite 输出的 localhost 地址，通常是：

```bash
http://localhost:5173/
```

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

## 本地预览构建产物

```bash
npm run preview
```

## 部署到 Vercel

1. 将项目推送到 GitHub、GitLab 或 Bitbucket。
2. 在 Vercel 中导入该仓库。
3. Framework Preset 选择 `Vite`。
4. Build Command 使用：

```bash
npm run build
```

5. Output Directory 使用：

```bash
dist
```

6. 点击 Deploy。

部署完成后，Vercel 会提供 HTTPS 地址。follow 已配置 PWA manifest 和 service worker，可在支持的浏览器中添加到手机桌面。
