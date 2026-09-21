import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, "build", "windows", `win-${process.arch}`, "ArkWallpaper.exe");
const child = spawn(executable, [], { cwd: root, detached: true, stdio: "ignore", windowsHide: true });
child.on("error", () => { console.error("无法启动 Windows 壁纸，请先运行 npm run windows:build。"); process.exitCode = 1; });
child.unref();
