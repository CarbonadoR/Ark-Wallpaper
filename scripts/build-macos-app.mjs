import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config, rootDir } from "../server/config.mjs";

const outputDir = path.join(rootDir, "build", "macos");
const appDir = path.join(outputDir, "Arknights Dynamic Wallpaper.app");
const contentsDir = path.join(appDir, "Contents");
const executableDir = path.join(contentsDir, "MacOS");
const executablePath = path.join(executableDir, "ArknightsWallpaper");
const sourcePath = path.join(rootDir, "macos", "Sources", "ArknightsWallpaper", "main.swift");
const escapeXML = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const npmPath = execFileSync("/usr/bin/which", ["npm"], { encoding: "utf8" }).trim();

await fs.rm(appDir, { recursive: true, force: true });
await fs.mkdir(executableDir, { recursive: true });
execFileSync("/usr/bin/swiftc", ["-O", "-parse-as-library", "-framework", "AppKit", "-framework", "CoreGraphics", "-framework", "WebKit", sourcePath, "-o", executablePath], { cwd: rootDir, stdio: "inherit" });
const template = await fs.readFile(path.join(rootDir, "macos", "Info.plist"), "utf8");
const plist = template.replace("__PROJECT_ROOT__", escapeXML(rootDir)).replace("__NPM_PATH__", escapeXML(npmPath)).replace("__SERVER_URL__", escapeXML(`http://${config.host}:${config.port}`));
await fs.writeFile(path.join(contentsDir, "Info.plist"), plist);
execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appDir], { stdio: "inherit" });
console.log(`macOS 壁纸应用已生成：${appDir}`);
