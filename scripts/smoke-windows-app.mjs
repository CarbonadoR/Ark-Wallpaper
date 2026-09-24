import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDirectory = process.argv.find(value => value.startsWith("--app-dir="))?.slice("--app-dir=".length);
const output = appDirectory ? path.resolve(root, appDirectory) : path.join(root, "build", "windows", `win-${process.arch}`);
const config = JSON.parse(await fs.readFile(path.join(output, "launch.local.json"), "utf8"));
// Use a separate port and user-data directory; never overwrite the user's saved settings.
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.on("error", reject);
  socket.listen(0, "127.0.0.1", () => { const { port } = socket.address(); socket.close(() => resolve(port)); });
});
const run = await fs.mkdtemp(path.join(root, "build", "windows", "smoke-"));
config.serverUrl = `http://127.0.0.1:${port}`;
const configPath = path.join(run, "launch.local.json");
const report = path.join(run, "report.json");
await fs.writeFile(configPath, JSON.stringify(config));
await fs.mkdir(path.join(run, "smoke-user-data"));
await fs.writeFile(path.join(run, "smoke-user-data", "settings.json"), JSON.stringify({ diagnosticsEnabled: true }));
const child = spawn(path.join(output, "ArkWallpaper.exe"), ["--config", configPath, "--smoke-report", report], {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: { ...process.env, ARKNIGHTS_SCENE_SETTINGS: path.join(run, "scenes.local.json") },
});
const deadline = setTimeout(() => {
  // Terminate only this harness process tree if a native API stops completing.
  spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}, 180_000);
const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }).finally(() => clearTimeout(deadline));
const result = JSON.parse(await fs.readFile(report, "utf8"));
if (result.passed && result.serverOwned) {
  const listening = () => new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
  for (let attempt = 0; attempt < 10 && await listening(); attempt++) await new Promise((resolve) => setTimeout(resolve, 200));
  if (await listening()) { result.passed = false; result.checks.push("FAIL-owned-server-stopped-on-exit"); }
  else result.checks.push("owned-server-stopped-on-exit");
  await fs.writeFile(report, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
console.log(`验证产物：${path.relative(root, run)}`);
if (exit !== 0 || !result.passed) process.exitCode = 1;
