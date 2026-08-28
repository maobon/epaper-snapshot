# Linux 云主机部署

本项目采用普通 Node.js 服务部署，不依赖 OpenAI Sites、Cloudflare Workers 或其他平台托管运行时。

这里的职责分为两部分：

- `pnpm start`：常驻运行 Next.js Web 服务，应交给 systemd、Supervisor 或 PM2 等进程管理器守护。
- `pnpm snapshots:export`：由系统定时任务在每个整点调用，连接已经运行的 Web 服务，更新四张墨水屏截图，并校验截图数据与图片 API 使用的服务端响应一致。

定时任务不会自行启动开发服务器。如果 Web 服务不可用，它会返回失败，便于监控发现部署问题。

每次任务会同时检查：

- 浏览器实际渲染页面与 `/api/image/*.png` 的数据指纹一致；
- 天气与汇率数据来自实时服务端响应，而非本地回退数据；
- 四张截图和四个图片接口的尺寸正确；
- 图片接口生成的每个像素都属于 `0 / 85 / 170 / 255` 四级灰阶。

运行日志和结果统一写入根目录 `logs/`：

- `logs/hourly-export.log`：正常执行信息；
- `logs/hourly-export-error.log`：失败原因与堆栈；
- `logs/monitor-report.json`：最近一次完整监测结果。

截图 PNG 单独保存在根目录 `snapshot/`。任一检查失败时命令返回非零退出码，报告中会记录已完成项目和失败原因。

## 1. 准备环境配置

```bash
cp .env.example .env
command -v google-chrome-stable google-chrome chromium chromium-browser
```

根据第二条命令的输出调整 `.env` 中的 `EPAPER_CHROME_PATH`。如果没有任何输出，请先安装 Google Chrome 或 Chromium。

低配云主机上可以适当延长单页 Chrome 截图等待时间（默认 120 秒，最小 10 秒）。以下配置允许每个页面最多等待 180 秒；四个页面仍然串行处理，不会同时启动多个 Chrome 实例：

```dotenv
EPAPER_CHROME_TIMEOUT_MS=180000
```

## 2. 安装与构建

```bash
pnpm install --frozen-lockfile
pnpm build
```

项目已将 pnpm 的单次下载超时提高到 10 分钟，并增加到 5 次重试，以适应云主机下载约 42 MB 的 Next.js Linux SWC 包。如果安装曾因网络超时中断，直接重新执行上面的安装命令即可。

## 3. 启动生产服务

```bash
pnpm start
```

服务默认监听 `0.0.0.0:3001`。生产环境不要使用 `pnpm dev`，也不要仅依赖交互式终端维持服务进程。

## 4. 配置整点任务

如果已有定时任务，只需确认它等价于以下 cron 配置，并把项目路径与 `pnpm` 路径替换为云主机上的实际值：

```cron
0 * * * * cd /opt/weatherInfo-ePaper && /usr/local/bin/pnpm snapshots:export
```

`0 * * * *` 表示每小时的第 0 分钟执行一次。避免再配置第二套应用内定时器，否则可能重复截图。

如果需要手动重新生成截图，可在服务运行期间执行：

```bash
pnpm snapshots:export
```

## 常见检查

```bash
curl -I http://127.0.0.1:3001/currency
ls -lh snapshot/*-frontend.png
tail -n 50 logs/hourly-export-error.log
cat logs/monitor-report.json
```

如果只希望在上游暂时不可用时继续用回退数据生成图片，可设置 `EPAPER_REQUIRE_LIVE_DATA=false`；此时报告仍会把数据源标记为 `fallback`。

以 root 运行时，截图进程会自动添加 Chrome 的 `--no-sandbox` 参数并显示警告。长期运行建议创建普通服务用户，以保留 Chrome sandbox 的安全保护。
