import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("Windows 宿主构建脚本需要 Windows 和 .NET 8 或更新的 SDK。");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = process.argv.find((value) => value.startsWith("--arch="))?.slice(7) ?? process.arch;
const architectures = argument === "all" ? ["x64", "arm64"] : [argument];
if (architectures.some((arch) => !["x64", "arm64"].includes(arch))) throw new Error("架构必须为 x64、arm64 或 all。");
const local = path.join(root, "config", "runtime.local.json");
const configPath = process.env.ARKNIGHTS_VIEWER_CONFIG || (await fs.access(local).then(() => local).catch(() => path.join(root, "config", "runtime.example.json")));
const runtime = JSON.parse(await fs.readFile(configPath, "utf8"));
const host = process.env.ARKNIGHTS_VIEWER_HOST || runtime.host || "127.0.0.1";
const port = Number(process.env.ARKNIGHTS_VIEWER_PORT || runtime.port || 8791);
if (!["127.0.0.1", "localhost", "::1"].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Windows 壁纸需要有效的 loopback host/port 配置。");
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
await fs.access(npmCli);
for (const arch of architectures) {
  const output = path.join(root, "build", "windows", `win-${arch}`);
  const result = spawnSync("dotnet", ["publish", path.join(root, "windows", "ArkWallpaper", "ArkWallpaper.csproj"), "-c", "Release", "-r", `win-${arch}`, "--self-contained", "true", "-o", output, "-p:DebugType=None", "-p:DebugSymbols=false"], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  // Machine-specific developer launcher data stays exclusively in ignored build/.
  await fs.writeFile(path.join(output, "launch.local.json"), JSON.stringify({ projectRoot: root, nodePath: process.execPath, npmCliPath: npmCli, serverUrl: `http://${host === "::1" ? "[::1]" : host}:${port}` }, null, 2));
  console.log(`Windows ${arch} 构建完成：build/windows/win-${arch}/ArkWallpaper.exe`);
}
