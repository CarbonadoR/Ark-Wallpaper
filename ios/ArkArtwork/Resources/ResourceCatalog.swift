import Foundation
import CryptoKit

struct Artwork: Codable, Identifiable, Equatable {
 let id, name, outfit, kind, mediaType: String
 let image, atlas, skeleton, skeletonFormat: String?
 let pages: [TexturePage]?
}
struct TexturePage: Codable, Equatable { let path, alphaMode: String }
struct ArtworkBackground: Codable, Identifiable, Equatable { let id, name: String; let images: [String] }
struct PackFile: Codable { let path: String; let bytes: Int; let sha256: String }
struct ResourceCatalog: Decodable {
 let schemaVersion: Int
 let packID: String
 let version: Int
 let models: [Artwork]
 let backgrounds: [ArtworkBackground]
 let files: [PackFile]
 var root: URL = URL(fileURLWithPath: "/")
 enum CodingKeys: String, CodingKey { case schemaVersion,packID,version,models,backgrounds,files }
 static func load(from root: URL) throws -> ResourceCatalog {
  var value = try JSONDecoder().decode(Self.self, from: Data(contentsOf: root.appendingPathComponent("manifest.json")))
  value.root = root.resolvingSymlinksInPath()
  guard value.schemaVersion == 1, (!value.models.isEmpty || !value.backgrounds.isEmpty),
    Set(value.models.map(\.id)).count == value.models.count,
    Set(value.backgrounds.map(\.id)).count == value.backgrounds.count else { throw ResourceError.invalidManifest }
  let listed = Set(value.files.map(\.path))
  guard listed.count == value.files.count else {throw ResourceError.invalidManifest}
  for file in value.files {
   _ = try value.location(file.path)
   guard file.bytes >= 0,file.sha256.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else {throw ResourceError.invalidManifest}
  }
  for model in value.models {
   let dependencies: [String]
   if model.mediaType == "image", let image = model.image { dependencies = [image] }
   else if model.mediaType == "spine", let atlas=model.atlas, let skeleton=model.skeleton, let pages=model.pages, !pages.isEmpty, ["binary","json"].contains(model.skeletonFormat ?? "") {
    dependencies = [atlas,skeleton] + pages.map(\.path)
    guard pages.allSatisfy({ ["pma","straight"].contains($0.alphaMode) }) else { throw ResourceError.invalidManifest }
   } else { throw ResourceError.invalidManifest }
   guard dependencies.allSatisfy({listed.contains($0)}) else { throw ResourceError.invalidManifest }
  }
  for b in value.backgrounds { guard (1...2).contains(b.images.count), b.images.allSatisfy({listed.contains($0)}) else { throw ResourceError.invalidManifest } }
  return value
 }
 func resolve(_ relative: String) throws -> URL {
  let url=try location(relative)
  guard (try? url.resourceValues(forKeys:[.isRegularFileKey]).isRegularFile) == true else {throw ResourceError.missingFile}
  return url
 }
 func validate(_ paths:[String]) throws {
  for path in paths {
   guard let entry=files.first(where:{$0.path == path}) else {throw ResourceError.invalidManifest}
   let url=try resolve(path)
   guard try url.resourceValues(forKeys:[.fileSizeKey]).fileSize == entry.bytes else {throw ResourceError.invalidManifest}
   let digest=SHA256.hash(data:try Data(contentsOf:url,options:.mappedIfSafe)).map{String(format:"%02x",$0)}.joined()
   guard digest == entry.sha256 else {throw ResourceError.invalidManifest}
  }
 }
 private func location(_ relative:String) throws -> URL {
  guard !relative.isEmpty, !relative.hasPrefix("/"), !relative.contains("\\"), !relative.split(separator:"/",omittingEmptySubsequences:false).contains(where: {$0 == ".." || $0 == "." || $0.isEmpty}) else { throw ResourceError.unsafePath }
  let url = root.appendingPathComponent(relative).resolvingSymlinksInPath()
  guard url.path.hasPrefix(root.path + "/") else { throw ResourceError.unsafePath }
  return url
 }
}
enum ResourceError: LocalizedError {
 case invalidManifest, unsafePath, missingFile, downloadNotConfigured, downloadBusy
 var errorDescription: String? {
  switch self {
  case .invalidManifest: return "资源包清单无效，请重新生成测试包。"
  case .unsafePath: return "资源路径不合法。"
  case .missingFile: return "资源文件不存在，请重新准备资源包。"
  case .downloadNotConfigured: return "资源下载服务未配置。"
  case .downloadBusy: return "已有资源正在下载，请稍候。"
  }
 }
}
