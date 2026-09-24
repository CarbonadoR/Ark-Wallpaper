# Ark Wallpaper

本项目是一个本地《明日方舟》动态/静态立绘查看器，并提供桌面动态壁纸功能和交互功能

> [!IMPORTANT]
> 桌面壁纸应用已支持 Windows 和 macOS（Mac）。网页查看器也可在本地浏览器中运行。

本仓库只包含查看器和壁纸应用的源代码，不包含、下载或分发任何游戏资源。运行前需要由用户自行准备资源，并放入项目根目录的 `arts`、`charpack`、`chartable` 和 `skinpack`。这四个资源目录已被 `.gitignore` 排除，禁止提交或推送到 Git 仓库。

## 功能

- 浏览明日方舟动态立绘、动态头像和静态立绘
- 按干员浏览精英一、精英二、皮肤、动态立绘和动态头像
- 点击模型时随机触发可用的 `Interact` / `Special` 动作
- Windows / macOS 多屏桌面壁纸、交互开关、填充模式、位置/缩放及布局锁定
- 桌面背景色、背景图选择
- 手动填充背景部件：添加可用图片到场景层，调整位置、缩放和图层顺序，按模型保存并同步到壁纸
- 可拖动，可切换主题的桌面时钟，可用类明日方舟的透视倾斜效果

## 平台与环境

- 桌面壁纸：Windows 10/11、macOS
- 本地网页查看器：现代浏览器
- Node.js 与 npm
- macOS 壁纸构建还需要系统自带的 Swift 编译器、AppKit、WebKit 和 `codesign`
- Windows 壁纸构建还需要 .NET 8 或更新的 SDK，以及 Microsoft Edge WebView2 Runtime

macOS 壁纸应用是本地临时签名构建，不是经过 Apple 公证的发行包。

## 准备资源

资源获取方式请参考 [Ark-Wallpaper-Resources](https://github.com/CarbonadoR/Ark-Wallpaper-Resources.git)：通过已启用 ADB 的模拟器提取本地游戏资源，并使用 ArkUnpacker 解包为下列四个目录。本项目不托管任何游戏资源。
将资源放在仓库根目录，目录结构如下：

```text
Ark-Wallpaper/
├── arts/
│   ├── dynchars/                       # Spine 动态资源
│   └── ui/
│       └── homebackground/wrapper/     # UI 与主页背景
├── charpack/                           # 普通/精英静态立绘
├── chartable/                          # character_table*.json 等角色表
└── skinpack/                           # 皮肤静态立绘
```

`chartable` 也可以通过配置指向单个角色表 JSON。资源的实际内容和授权不属于本项目。

复制本地配置：

```bash
cp config/runtime.example.json config/runtime.local.json
```

默认示例使用相对于 `config` 目录的路径：

```json
{
  "host": "127.0.0.1",
  "port": 8791,
  "resourceRoot": "../arts/dynchars",
  "backgroundRoot": "../arts/ui/homebackground/wrapper",
  "uiRoot": "../arts/ui",
  "charpackRoot": "../charpack",
  "skinpackRoot": "../skinpack",
  "characterTableFile": "../chartable",
  "metadataFile": "./metadata.local.json"
}
```

`config/runtime.local.json` 和 `config/metadata.local.json` 也已被 Git 忽略，可安全填写本机绝对路径。不要把带有本机路径、私有地址、代理、令牌或来源信息的本地配置复制回示例文件。

`characterTableFile` 支持两种配置方式：

- 指向目录（默认 `../chartable`）：自动选择目录中修改时间最新的 `character_table*.json`，支持 `character_table_<hash>.json` 这类带 hash 的文件名。
- 指向具体文件：例如 `../chartable/character_table_<hash>.json`；此模式不限制文件名，适合锁定某个资源版本。

也可以用环境变量 `ARKNIGHTS_CHARACTER_TABLE` 临时覆盖该路径。本地配置和 `chartable` 目录都不会提交到仓库。

如需手动补充名称，可从 `config/metadata.example.json` 创建 `config/metadata.local.json`：

```json
{
  "groups": {
    "char_resource_id": {
      "name": "角色名",
      "skinName": "服装名"
    }
  }
}
```

## 运行网页查看器

```bash
npm install
npm run audit
npm run build
npm start
```

默认仅监听本机地址：<http://127.0.0.1:8791/>。

开发模式：

```bash
npm run dev
```

## 运行 Windows 桌面壁纸

```powershell
npm install
npm run windows:run
```

应用输出到 `build/windows/win-x64/` 或 `build/windows/win-arm64/`，也可直接启动其中的 `ArkWallpaper.exe`。壁纸设置、交互模式、时钟和场景编辑入口位于系统托盘菜单中。

如需同时构建 x64 和 arm64：

```powershell
npm run windows:build -- --arch=all
```

构建产物自带 .NET 运行时，运行时仍需保留工程和本地资源。更多说明见 [Windows 开发与验证指南](windows/DEVELOPMENT.md)。

## 运行 macOS 桌面壁纸

```bash
npm install
npm run macos:run
```

应用会构建到：

```text
build/macos/Arknights Dynamic Wallpaper.app
```

壁纸设置位于 macOS 菜单栏应用的“壁纸外观、尺寸与位置”中。模型 ID 可从网页查看器的 Model Inspector 复制。添加或修改角色名称不会改变稳定模型 ID。

桌面时钟也在该设置中配置。取消“锁定位置”并启用壁纸交互后可以拖动；重新锁定后，时钟区域不会拦截角色点击。

## 手动填充背景部件

在网页查看器中选择模型，打开“场景编辑”；Windows 也可从托盘菜单的“编辑当前模型场景…”进入。选择可用的外置图片或已有背景，将其添加到模型后方的场景层，再通过拖动、滚轮或数值输入调整位置和缩放，也可调整图层顺序、透明度及混合方式。

点击“保存并同步壁纸”后，场景按模型保存到本机配置，并同步至已打开的壁纸页面。无法自动识别位置的背景部件可通过此方式手动摆放；原始 3D 场景布局不会自动还原。详细用法见 [手动场景层](docs/scenes.md)。

## 提交前资源与隐私检查

资源目录、本地配置、构建产物和日志均不应进入版本控制。提交前建议执行：

```bash
git check-ignore arts charpack chartable skinpack
git ls-files -- arts charpack chartable skinpack
git status --short
```

第一条应显示四个目录均由 `.gitignore` 排除；第二条必须没有输出。如果第二条列出任何文件，请停止提交并先从 Git 索引中移除这些资源。

公开发布前还应检查提交内容中不存在：

- 本机用户名和绝对路径
- 私有服务器、镜像源或上游资源地址
- HTTP/SOCKS 代理地址
- Cookie、访问令牌、密钥和账号信息

## 免责声明

本项目是社区独立开发的非官方、非商业本地工具，与《明日方舟》及其开发商、发行商、运营方或其他相关权利人不存在隶属、授权、认可或合作关系。

本仓库不包含游戏资源，也不提供资源下载或资源使用许可。游戏名称、角色、美术、动画、音频、文本、商标及其他内容的权利归各自权利人所有。用户有责任确保其资源来源和使用方式符合适用法律、服务条款及权利人的授权要求。详见 [DISCLAIMER.md](DISCLAIMER.md)。

## 许可证

本仓库中的原创源代码以 [PolyForm Noncommercial License 1.0.0](LICENSE) 许可。该许可证仅适用于本项目原创代码，不适用于用户自行放入 `arts`、`charpack`、`chartable`、`skinpack` 的第三方或游戏资源，也不授予任何游戏知识产权的许可。
