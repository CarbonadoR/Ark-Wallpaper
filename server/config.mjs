import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localPath = path.join(rootDir, "config", "runtime.local.json");
const examplePath = path.join(rootDir, "config", "runtime.example.json");
const configPath = process.env.ARKNIGHTS_VIEWER_CONFIG || (fs.existsSync(localPath) ? localPath : examplePath);
const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
const resolveFromConfig = (value) => path.resolve(path.dirname(configPath), value);
const resourceRoot = path.resolve(process.env.ARKNIGHTS_RESOURCE_ROOT || resolveFromConfig(raw.resourceRoot));
const optionalPath = (environmentName, value) => {
  const configured = process.env[environmentName] || value;
  return configured ? path.resolve(process.env[environmentName] || resolveFromConfig(value)) : null;
};

export const config = {
  host: process.env.ARKNIGHTS_VIEWER_HOST || raw.host || "127.0.0.1",
  port: Number(process.env.ARKNIGHTS_VIEWER_PORT || raw.port || 8791),
  resourceRoot,
  backgroundRoot: path.resolve(process.env.ARKNIGHTS_BACKGROUND_ROOT || (raw.backgroundRoot ? resolveFromConfig(raw.backgroundRoot) : path.join(resourceRoot, "..", "ui", "homebackground", "wrapper"))),
  uiRoot: path.resolve(process.env.ARKNIGHTS_UI_ROOT || (raw.uiRoot ? resolveFromConfig(raw.uiRoot) : path.join(resourceRoot, "..", "ui"))),
  metadataFile: path.resolve(process.env.ARKNIGHTS_METADATA_FILE || resolveFromConfig(raw.metadataFile || "./metadata.local.json")),
  charpackRoot: optionalPath("ARKNIGHTS_CHARPACK_ROOT", raw.charpackRoot),
  skinpackRoot: optionalPath("ARKNIGHTS_SKINPACK_ROOT", raw.skinpackRoot),
  characterTableFile: optionalPath("ARKNIGHTS_CHARACTER_TABLE", raw.characterTableFile),
  distDir: path.join(rootDir, "dist"),
};

if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("端口配置无效");
if (!fs.existsSync(config.resourceRoot)) throw new Error("动态立绘资源目录不存在，请配置 resourceRoot");
