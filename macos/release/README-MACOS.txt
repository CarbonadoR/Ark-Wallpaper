Ark Wallpaper - macOS

1. 将整个 ZIP 解压到可写目录。保留 app、server、dist 等目录结构。
2. 安装 Node.js 22.12+ 或 24 LTS（含 npm）。
3. 双击 Start-Wallpaper.command；首次启动联网安装依赖并应用 Spine 补丁。
4. 菜单栏“资源下载与更新…”中先填写自己的 HTTPS 资源服务地址。
   发布包仅包含占位地址；保存地址后可检查更新、下载全部精简资源或更新缓存。
   打开查看器浏览人物时会自动下载并缓存人物资源；也可使用已有本地资源。

macOS 13 或更新版本，通用二进制支持 Apple Silicon 与 Intel。
本包使用临时签名，未经 Apple 公证；如系统阻止打开，请通过系统设置“隐私与安全性”检查并允许。
不要单独移动 app 内的应用。移动整个解压目录后重新运行启动脚本即可。
升级前退出旧版本；保留 config/*.local.json、.resource-cache 及自己的资源目录。
完整桌面游戏资源不包含在安装包中，首次下载需要网络。
更多说明见 docs/resource-updates.md。许可证见 LICENSE。
