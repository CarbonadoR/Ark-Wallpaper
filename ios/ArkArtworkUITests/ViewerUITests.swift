import XCTest
final class ViewerUITests: XCTestCase {
 func testResourceDownloadAndFullDownloadCancellation() throws {
  XCUIDevice.shared.orientation = .portrait
  let app=XCUIApplication();app.launch()
  XCTAssertTrue(app.buttons["resource-downloads"].waitForExistence(timeout:15));app.buttons["resource-downloads"].tap()
  let field=app.textFields["resource-url"];XCTAssertTrue(field.waitForExistence(timeout:5))
  guard let source=field.value as? String,source.hasPrefix("https://"),source != "https://资源服务地址/",!source.contains("example.invalid") else{throw XCTSkip("Configure an HTTPS resource service in local build configuration for the network smoke test.")}
  app.buttons["resource-check"].tap()
  let first=app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH %@","download-char_")).firstMatch
  XCTAssertTrue(first.waitForExistence(timeout:45));capture("resource-catalog",app)
  for _ in 0..<4{if first.isHittable{break};app.swipeUp()}
  first.tap();wait(NSPredicate(format:"value == %@","cached"),first,timeout:180)
  capture("resource-character-cached",app)
  for _ in 0..<4{if app.buttons["resource-download-all"].isHittable{break};app.swipeDown()}
  app.buttons["resource-download-all"].tap()
  XCTAssertTrue(app.buttons["resource-cancel"].waitForExistence(timeout:10));app.buttons["resource-cancel"].tap()
  wait(NSPredicate(format:"exists == false"),app.buttons["resource-cancel"],timeout:30);capture("resource-cancelled",app)
  app.buttons["完成"].tap();XCTAssertTrue(app.buttons["models"].waitForExistence(timeout:10));XCTAssertFalse(app.staticTexts["error"].exists)
 }
 private func wait(_ predicate:NSPredicate,_ object:Any,timeout:TimeInterval=10,file:StaticString=#filePath,line:UInt=#line) {
  XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:predicate,object:object)],timeout:timeout),.completed,file:file,line:line)
 }
 private func capture(_ name:String,_ app:XCUIApplication) {
  let image=XCTAttachment(screenshot:XCUIScreen.main.screenshot());image.name=name;image.lifetime = .keepAlways;add(image)
 }
 private func select(_ i:Int,_ app:XCUIApplication) {
  app.buttons["models"].tap()
  let row=app.buttons["model-\(i)"]
  XCTAssertTrue(row.waitForExistence(timeout:5))
  for _ in 0..<4 {if row.isHittable {break};app.swipeUp()}
  let id=row.value as? String ?? "missing"
  row.tap()
  wait(NSPredicate(format:"value == %@",id),app.otherElements["artwork"])
  wait(NSPredicate(format:"exists == false"),app.buttons["model-\(i)"])
 }
 func testViewerAndWallpaperExport() {
  XCUIDevice.shared.orientation = .portrait
  let app=XCUIApplication();app.launch()
  XCTAssertTrue(app.buttons["models"].waitForExistence(timeout:15))
  for i in 0..<4 {
   select(i,app);app.buttons["reset"].tap()
   capture("sample-\(i)",app)
  }
  // Static export must produce a still preview and no live-photo preview.
  app.buttons["export"].tap()
  XCTAssertTrue(app.images["static-preview"].waitForExistence(timeout:30))
  capture("static-export",app)
  app.buttons["close-export"].tap()
  select(0,app)
  app.buttons["backgrounds"].tap();app.buttons["background-0"].tap()
  app.buttons["pause"].tap();XCTAssertTrue(app.buttons["pause"].label.contains("播放"))
  app.buttons["pause"].tap()
  let preview=app.otherElements["artwork"]
  preview.swipeLeft();preview.pinch(withScale:1.4,velocity:1);app.buttons["reset"].tap()
  capture("background-portrait",app)
  XCUIDevice.shared.orientation = .landscapeLeft
  wait(NSPredicate{_,_ in app.frame.width > app.frame.height},app)
  Thread.sleep(forTimeInterval:1)
  capture("landscape",app)
  XCUIDevice.shared.orientation = .portrait
  wait(NSPredicate{_,_ in app.frame.height > app.frame.width},app)
  Thread.sleep(forTimeInterval:1)
  app.buttons["export"].tap()
  XCTAssertTrue(app.descendants(matching:.any)["live-preview"].firstMatch.waitForExistence(timeout:90))
  capture("live-export",app)
  app.buttons["save-wallpaper"].tap()
  XCTAssertTrue(app.staticTexts["wallpaper-saved"].waitForExistence(timeout:30))
  capture("live-saved",app)
  app.buttons["close-export"].tap()
  XCUIDevice.shared.press(.home);app.activate()
  XCTAssertTrue(app.buttons["models"].waitForExistence(timeout:10))
 }
}
