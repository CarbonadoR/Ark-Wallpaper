import { config } from "../server/config.mjs";
import { scanResources } from "../server/catalog.mjs";

const index = scanResources(config.resourceRoot, config.metadataFile);
const versions = Object.groupBy(index.models, (model) => model.spineVersion);
const formats = Object.groupBy(index.models, (model) => model.skeletonFormat);
console.log(`资源组：${index.groups.length}`);
console.log(`可配对模型：${index.models.length}`);
console.log(`骨骼格式：${Object.entries(formats).map(([key, values]) => `${key} ${values.length}`).join(" / ")}`);
console.log(`Spine 版本：${Object.entries(versions).map(([key, values]) => `${key} ${values.length}`).join(" / ")}`);
if (index.issues.length) {
  console.error(JSON.stringify(index.issues, null, 2));
  process.exitCode = 1;
} else {
  console.log("结构审计通过：所有图集均已找到骨骼和纹理。");
}
