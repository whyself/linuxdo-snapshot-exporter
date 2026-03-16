# linuxdo-snapshot-exporter

Chrome 扩展：抓取 Linux.do 主题并导出内容。

## 功能

- Markdown 导出（支持导出范围）
  - 仅主楼（默认）
  - 主楼 + 楼主回帖
  - 全部楼层
- 长图导出（整页拼接截图）
  - 自动滚动页面并分段截图
  - 自动拼接为一张 PNG 长图
- 图片在 Markdown 中保留原图 URL
- 文件名默认使用帖子标题
- 输出包含 YAML Front Matter（标题、URL、作者、发布时间、标签、导出时间等）

## 本地安装（Chrome）

1. 打开 `chrome://extensions/`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前仓库目录 `linuxdo-snapshot-exporter`

## 使用方式

1. 打开 Linux.do 帖子页（`https://linux.do/t/...`）
2. 点击扩展图标
3. 选择导出范围
4. 点击“导出 Markdown”或“导出长图”
5. 在保存对话框中保存文件

## 说明

- 长图导出依赖页面滚动截图，导出过程中请不要切换标签页。
- 若 Linux.do 页面结构调整，抓取规则可能需要同步更新。

## 仓库

- GitHub: https://github.com/whyself/linuxdo-snapshot-exporter
