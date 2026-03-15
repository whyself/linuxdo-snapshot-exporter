# snapshot

Chrome 插件：快照 Linux.do 主题并导出为 Markdown（首版默认仅主楼）。

## 功能

- 导出范围可选：
  - 仅主楼（默认）
  - 主楼 + 楼主回帖
  - 全部楼层
- 图片导出为 Markdown 图片语法，保留原图 URL
- 文件名规则：`帖子标题.md`
- 输出包含 YAML Front Matter（标题、URL、作者、发布时间、标签、导出时间等）
- 抓取失败时给出明确提示：页面结构可能已变更，请复制源码上报

## 本地安装（Chrome）

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前仓库目录 `snapshot`

## 使用方式

1. 打开 Linux.do 主题页（例如 `https://linux.do/t/...`）
2. 点击插件图标
3. 选择导出范围（默认仅主楼）
4. 点击“导出为 Markdown”
5. 在弹出的保存对话框中保存文件

## 已知限制

- 首版依赖页面 DOM 结构，若 Linux.do 改版可能导致抓取失败
- 富文本极端样式可能有轻微格式差异
- 当前仅适配 Linux.do 帖子页

## 仓库

- GitHub: https://github.com/whyself/snapshot
