Ark Wallpaper v0.1.0 - Windows

1. 将整个压缩包解压到可写目录。不要在压缩包预览中直接运行。
2. 安装 Node.js 22.12+ 或 24 LTS（含 npm）和 Microsoft Edge WebView2 Runtime。
3. 将自己的 arts、charpack、skinpack、chartable 资源目录放在解压目录中。
   资源提取工具：https://github.com/CarbonadoR/Ark-Wallpaper-Resources
   也可复制 config/runtime.example.json 为 config/runtime.local.json，填写已有资源位置。
4. 双击 Start-Wallpaper.cmd。首次启动需要联网安装依赖并应用 Spine 补丁。
启动成功后通过系统托盘图标管理壁纸；不要直接运行 app/ArkWallpaper.exe。
5. 移动解压目录或更新 Node.js 后，重新使用 Start-Wallpaper.cmd 即可生成新启动配置。
6. 需要开机启动时，在托盘菜单勾选“开机自启动（登录时）”；默认关闭，再次点击可取消。
   此设置仅作用于当前用户，无需管理员权限。移动应用或升级后请重新开启。
   若被 Windows 禁用，还需在系统“启动应用”设置中启用。

包内已含编译后的前端和 Windows 宿主，无需 .NET SDK 或手动编译。
x64 包用于常见 Intel/AMD 64 位 Windows；ARM64 包用于 Windows on ARM。
本版本 ARM64 已交叉编译，尚未在 ARM64 实机验证。

场景编辑：网页查看器选择模型后点击“场景编辑”，或使用托盘菜单“编辑当前模型场景…”。
添加可用背景图片后可拖动、缩放、调整图层顺序；点击“保存并同步壁纸”生效。
更多说明见 README.md、docs/scenes.md 和 windows/DEVELOPMENT.md。

包内不包含游戏资源。程序设置保存在本机应用数据目录，场景设置保存在 config/scenes.local.json。
退出旧版本后再运行新版本。升级时自行保留本地资源、runtime.local.json、metadata.local.json、scenes.local.json。
代码许可见 LICENSE；第三方依赖许可归各自项目所有；游戏资源不属于本项目许可证范围。
