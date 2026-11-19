import SwiftUI
import MetalKit
import PhotosUI

@MainActor final class WallpaperExportModel: ObservableObject {
 @Published var progress = 0.0
 @Published var files: WallpaperFiles?
 @Published var livePhoto: PHLivePhoto?
 @Published var error: String?
 @Published var exporting = false
 @Published var saving = false
 @Published var saved = false
 private var task: Task<Void,Never>?
 func start(from viewer:ViewerModel) {
  guard !exporting,files == nil,let catalog=viewer.catalog,let artwork=viewer.model else {return}
  guard viewer.viewport.width > 1,viewer.viewport.height > viewer.viewport.width else {error=WallpaperError.invalidSize.localizedDescription;return}
  let viewport=viewer.viewport
  let snapshot=ViewerModel();snapshot.scale=viewer.scale;snapshot.offset=viewer.offset;snapshot.backgroundColor=viewer.backgroundColor
  exporting=true;error=nil
  task=Task {
   var result:WallpaperFiles?
   do {
    let view=MTKView(frame:.zero,device:MTLCreateSystemDefaultDevice());view.colorPixelFormat = .bgra8Unorm
    let renderer=try ArtworkRenderer(view:view,state:snapshot)
    try renderer.load(catalog:catalog,model:artwork)
    try renderer.setBackground(catalog:catalog,background:viewer.background)
    let size=CGSize(width:1080,height:floor(1080*viewport.height/viewport.width/2)*2)
    var previous=0.0
    let output=try await WallpaperExporter.export(size:size,live:artwork.mediaType == "spine",render:{time,pixel in
     try renderer.renderFrame(to:pixel,viewport:viewport,delta:Float(time-previous));previous=time
    },progress:{self.progress=$0})
    result=output
    if output.video != nil {self.livePhoto=try await output.livePhoto()}
    try Task.checkCancellation()
    self.files=output
    withExtendedLifetime(snapshot) {}
   } catch is CancellationError {result?.remove();self.error=WallpaperError.interrupted.localizedDescription}
   catch {result?.remove();self.error=error.localizedDescription}
   self.exporting=false
  }
 }
 func cancel() {task?.cancel();files?.remove();files=nil;livePhoto=nil}
 func interrupt() {if exporting {task?.cancel()}}
 func save() {
  guard let files,!saving,!saved else {return}
  saving=true;error=nil
  Task {
   do {try await files.saveToPhotos();saved=true}
   catch {self.error=error.localizedDescription}
   saving=false
  }
 }
}

struct WallpaperExportView: View {
 @ObservedObject var viewer:ViewerModel
 @StateObject private var export=WallpaperExportModel()
 @Environment(\.dismiss) private var dismiss
 @Environment(\.scenePhase) private var phase
 var body:some View {
  NavigationStack {
   VStack(spacing:16) {
    if export.exporting {
     Spacer();ProgressView(value:export.progress).padding(.horizontal,32)
     Text("正在生成壁纸 · \(Int(export.progress*100))%").monospacedDigit()
     Text("请保持应用在前台").font(.caption).foregroundStyle(.secondary);Spacer()
    } else if let files=export.files {
     if let livePhoto=export.livePhoto {LiveWallpaperPreview(photo:livePhoto).accessibilityIdentifier("live-preview")}
     else if let image=UIImage(contentsOfFile:files.photo.path) {Image(uiImage:image).resizable().scaledToFit().accessibilityIdentifier("static-preview")}
     Text(files.video == nil ? "静态壁纸" : "实况壁纸 · 长按预览").font(.headline)
     Button(export.saved ? "已保存到相册" : export.saving ? "正在保存…" : "保存到相册"){export.save()}
      .buttonStyle(.borderedProminent).disabled(export.saving || export.saved).accessibilityIdentifier("save-wallpaper")
     if export.saved {Label("已保存到相册",systemImage:"checkmark.circle.fill").foregroundStyle(.green).accessibilityIdentifier("wallpaper-saved")}
     Text("设置 → 墙纸 → 添加新墙纸 → 照片\n选择导出的图片；实况照片需开启播放。")
      .font(.callout).multilineTextAlignment(.center)
     Text("实况动画用于锁屏唤醒。能否开启动作由 iOS 判定，主屏显示静态画面。")
      .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
    }
    if let error=export.error {
     Text(error).foregroundStyle(.orange).multilineTextAlignment(.center).accessibilityIdentifier("export-error")
     if export.files == nil && !export.exporting {Button("重新生成"){export.start(from:viewer)}}
    }
   }.padding().navigationTitle("锁屏壁纸").navigationBarTitleDisplayMode(.inline)
    .toolbar{ToolbarItem(placement:.cancellationAction){Button(export.exporting ? "取消" : "完成"){dismiss()}.disabled(export.saving).accessibilityIdentifier("close-export")}}
  }.interactiveDismissDisabled(export.saving)
   .onAppear{export.start(from:viewer)}.onDisappear{export.cancel()}
   .onChange(of:phase){_,value in if value == .background {export.interrupt()}}
 }
}
private struct LiveWallpaperPreview:UIViewRepresentable {
 let photo:PHLivePhoto
 func makeUIView(context:Context)->PHLivePhotoView {
  let view=PHLivePhotoView();view.contentMode = .scaleAspectFit;view.isAccessibilityElement=true;view.accessibilityIdentifier="live-preview";view.accessibilityLabel="实况壁纸预览";return view
 }
 func updateUIView(_ view:PHLivePhotoView,context:Context) {
  if view.livePhoto !== photo {view.livePhoto=photo;view.startPlayback(with:.full)}
 }
}
