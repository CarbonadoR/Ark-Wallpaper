# Arknights Dynamic Character Viewer

用于在本地检查与展示 Spine 格式动态立绘资源的查看器，并附带 macOS 动态桌面壁纸应用。当前版本针对 `arknights-dynchars` 的实际目录结构与 Spine 3.8.99 资源进行了适配。

## 当前能力

- 自动扫描资源目录，不依赖预先存在的角色名数据库
- 支持二进制 `.skel` 与无扩展名 JSON 骨骼
- 支持多页 atlas、文件名不完全一致的骨骼/图集配对
- 按资源组检索，切换动态立绘、动态头像、入场动画与战斗层
- 可按资源类型筛选目录，并在窄屏设备使用滑出式资源目录与模型信息面板
- 枚举并播放骨骼内全部动画
- 点击画布播放模型交互动作，并在结束后自动回到待机动作
- 画布拖动、滚轮缩放与一键复位（拖动不会误触发交互）
- 支持复制稳定模型 ID，以及 `/` 聚焦检索、`R` 复位、`Esc` 关闭面板等快捷键
- macOS 多屏桌面壁纸、交互开关、填充模式、位置/缩放和布局锁定
- 按纹理与资源批次识别直通/预乘 Alpha，避免部件黑边、白边和半透明雾团
- 可选本地 metadata 覆盖层，后续可无侵入补充角色名与皮肤名

## 配置

复制示例并设置资源目录：

```bash
cp config/runtime.example.json config/runtime.local.json
```

`config/runtime.local.json` 不会被 Git 跟踪。角色名元数据可参照 `config/metadata.example.json` 创建 `config/metadata.local.json`：

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

## 运行

```bash
npm install
npm run audit
npm run build
npm start
```

默认地址为 `http://127.0.0.1:8791/`。

查看器采用黑、白、青色的终端式界面。左侧用于检索和筛选资源，中间切换资源变体并预览画面，右侧查看模型信息与播放动作；在窄屏下可通过顶部两侧按钮打开对应面板。

构建并运行 macOS 壁纸：

```bash
npm run macos:run
```

在查看器的 Model Inspector 中可找到稳定的 16 位模型 ID，壁纸菜单可用该 ID 切换资源。模型 ID 根据 atlas 相对路径生成，添加角色名元数据不会改变它。

## 资源说明

资源文件不会复制进本仓库，也不应提交到版本控制。查看器仅从本地配置的目录读取资源。

## 免责声明

本项目是由社区独立开发的非官方、非商业本地工具，与《明日方舟》、其开发商、发行商、运营方及相关权利人不存在隶属、授权、认可或合作关系。本仓库不提供或授予游戏资源的使用许可，用户应自行确保资源获取、缓存和展示行为符合适用法律、服务条款及权利人的授权要求。完整内容见 [DISCLAIMER.md](DISCLAIMER.md)。
