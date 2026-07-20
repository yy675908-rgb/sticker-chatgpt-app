# Sticker for ChatGPT

一个独立的私人表情包插件，**不会修改 Mood 项目**。初始表情库为空，不预置、不生成任何图片。

## 已实现

- 从手机或电脑上传图片，并存入 ChatGPT 文件库
- 从已有 ChatGPT 文件库选择图片
- 名称、标签、收藏、搜索
- 从插件表情库移除，不删除文件库原图
- 点“发送”后，把所选图片带入当前对话
- 私密 MCP 路径密钥，避免别人直接接入同一表情库

## 数据方式

图片本体由 ChatGPT 文件库保存；本服务只保存 `fileId`、名称、标签和收藏状态。元数据写入 `DATA_DIR/stickers.json`，部署时必须使用持久化磁盘。

## 本地运行

```bash
npm install
npm run check
npm run test:mcp
STICKER_ACCESS_KEY=换成至少12位的随机字符 npm start
```

连接地址：

```text
http://localhost:8000/mcp/你的STICKER_ACCESS_KEY
```

接入 ChatGPT 前，需要把地址通过 HTTPS 隧道或托管服务暴露出去，再在 ChatGPT 开发者模式中添加完整 MCP 地址。

## 部署

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yy675908-rgb/sticker-chatgpt-app)

仓库内含 `Dockerfile` 和 `render.yaml`。Render 方案使用带 1 GB 持久化磁盘的 `starter` 实例；创建 Blueprint 时填写 `STICKER_ACCESS_KEY`。最终连接地址类似：

```text
https://你的服务域名/mcp/你的STICKER_ACCESS_KEY
```

## 已验证

- 服务端与组件脚本语法检查
- MCP 初始化、工具列表、UI 资源读取
- 新增、改名、标签去重、收藏、删除与持久化流程
- 压缩包回装后再次执行全部检查

## 仍需真机确认

“发送”已按 ChatGPT Apps SDK 的文件与消息桥接接口实现。它必须在真实 ChatGPT 开发者模式里做一次端到端确认；本地 MCP 测试无法替代宿主内的文件选择、预览与发送。

原 APK 的只读识别结果见 `APK_REFERENCE.md`。