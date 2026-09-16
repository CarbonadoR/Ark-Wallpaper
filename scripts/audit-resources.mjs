import { config } from "../server/config.mjs";
import { scanResources } from "../server/catalog.mjs";
import { mergeStaticArt, scanStaticArt } from "../server/static-art.mjs";

const dynamicIndex = scanResources(config.resourceRoot, config.metadataFile);
const staticArt = scanStaticArt(config);
const index = mergeStaticArt(dynamicIndex, staticArt);
const versions = Object.groupBy(dynamicIndex.models, (model) => model.spineVersion);
const formats = Object.groupBy(dynamicIndex.models, (model) => model.skeletonFormat);
console.log(`资源组：${index.groups.length}`);
console.log(`动态模型：${dynamicIndex.models.length}`);
console.log(`静态立绘：${staticArt.models.length}`);
console.log(`骨骼格式：${Object.entries(formats).map(([key, values]) => `${key} ${values.length}`).join(" / ")}`);
console.log(`Spine 版本：${Object.entries(versions).map(([key, values]) => `${key} ${values.length}`).join(" / ")}`);
if (dynamicIndex.issues.length) {
  console.error(JSON.stringify(dynamicIndex.issues, null, 2));
  process.exitCode = 1;
} else {
  console.log("结构审计通过：所有图集均已找到骨骼和纹理。");
}
