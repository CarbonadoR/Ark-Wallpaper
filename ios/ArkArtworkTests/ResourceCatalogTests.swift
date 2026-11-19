import XCTest
@testable import ArkArtwork
final class ResourceCatalogTests: XCTestCase {
 func testMissingModelDoesNotHideOtherModels() throws {
  let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer {try? FileManager.default.removeItem(at:root)}
  try FileManager.default.copyItem(at:Bundle.main.url(forResource:"SamplePack",withExtension:nil)!,to:root)
  let original=try ResourceCatalog.load(from:root)
  let missing=original.models.first{$0.mediaType == "image"}!
  try FileManager.default.removeItem(at:original.resolve(missing.image!))
  let catalog=try ResourceCatalog.load(from:root)
  XCTAssertEqual(catalog.models.count,4)
  XCTAssertThrowsError(try catalog.resolve(missing.image!))
  XCTAssertNotNil(try catalog.resolve(catalog.models.first{$0.mediaType == "spine"}!.atlas!))
 }
 func testPackAndSafePaths() throws {
  let root = Bundle.main.url(forResource: "SamplePack", withExtension: nil)!
  let catalog = try ResourceCatalog.load(from: root)
  XCTAssertEqual(catalog.models.count, 4)
  XCTAssertEqual(catalog.backgrounds.count, 2)
  XCTAssertThrowsError(try catalog.resolve("../escape"))
  XCTAssertThrowsError(try catalog.resolve("/etc/passwd"))
  XCTAssertThrowsError(try catalog.resolve("missing.png"))
 }
 func testMissingManifest() { XCTAssertThrowsError(try ResourceCatalog.load(from: FileManager.default.temporaryDirectory)) }
 func testRemoteNotConfigured() async { do { _ = try await UnconfiguredDownloadProvider().catalog(); XCTFail() } catch { XCTAssertTrue(error.localizedDescription.contains("未配置")) } }
 @MainActor func testViewerResetAndAnimationSelection() {
  let model = ViewerModel(); model.scale = 2; model.offset = CGSize(width: 100, height: 90); model.reset()
  XCTAssertEqual(model.scale, 1); XCTAssertEqual(model.offset, .zero)
  XCTAssertEqual(ViewerModel.idle(["Walk", "Idle"]), "Idle")
  XCTAssertEqual(ViewerModel.interactions(["Idle", "Interact", "Tap"]), ["Interact"])
 }
 func testSpineFramesAndFailure() throws {
  let c = try ResourceCatalog.load(from: Bundle.main.url(forResource:"SamplePack",withExtension:nil)!)
  for m in c.models where m.mediaType == "spine" {
   let bridge = try SpineBridge(atlasURL: c.resolve(m.atlas!), skeletonURL: c.resolve(m.skeleton!), binary: m.skeletonFormat == "binary")
   XCTAssertFalse(bridge.animations.isEmpty)
   bridge.play(bridge.animations[0], loop: true)
   let a = bridge.update(0); let b = bridge.update(0.5)
   XCTAssertFalse(a.isEmpty); XCTAssertFalse(b.isEmpty)
   XCTAssertTrue(bridge.bounds.width > 0)
   XCTAssertTrue(a.allSatisfy { $0.vertices.count % 48 == 0 && !$0.indices.isEmpty })
  }
  XCTAssertThrowsError(try SpineBridge(atlasURL: URL(fileURLWithPath:"/missing.atlas"), skeletonURL: URL(fileURLWithPath:"/missing.json"), binary:false))
 }
}
