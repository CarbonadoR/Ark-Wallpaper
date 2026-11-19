import SwiftUI
import MetalKit
struct ArtworkMetalView: UIViewRepresentable {
 @ObservedObject var model: ViewerModel
 var active: Bool
 func makeCoordinator()->Coordinator {Coordinator()}
 func makeUIView(context:Context)->MTKView {
  let view=MTKView(frame:.zero,device:MTLCreateSystemDefaultDevice());view.colorPixelFormat = .bgra8Unorm;view.clearColor=MTLClearColorMake(0.035,0.045,0.065,1);view.preferredFramesPerSecond=60;view.isAccessibilityElement=true;view.accessibilityIdentifier="artwork";view.accessibilityLabel="立绘预览"
  do {let renderer=try ArtworkRenderer(view:view,state:model);context.coordinator.renderer=renderer;view.delegate=renderer}
  catch {DispatchQueue.main.async{model.error=error.localizedDescription}}
  let tap=UITapGestureRecognizer(target:context.coordinator,action:#selector(Coordinator.tap));view.addGestureRecognizer(tap)
  return view
 }
 func updateUIView(_ view:MTKView,context:Context){
  view.isPaused = !active
  view.accessibilityValue = model.loadedID
  guard let renderer=context.coordinator.renderer,let catalog=model.catalog,let artwork=model.model else{return}
  let key=artwork.id+":"+model.backgroundID+":"+model.resourceRevision.uuidString
  if renderer.selectedKey != key {
   renderer.selectedKey=key
   DispatchQueue.main.async {
    guard renderer.selectedKey==key else{return}
    do {if model.loadedID != artwork.id {try renderer.load(catalog:catalog,model:artwork);model.loadedID=artwork.id};try renderer.setBackground(catalog:catalog,background:model.background);model.error=nil}
    catch {model.error=error.localizedDescription}
   }
  }
 }
 static func dismantleUIView(_ uiView:MTKView,coordinator:Coordinator){uiView.isPaused=true;uiView.delegate=nil;coordinator.renderer=nil}
 @MainActor final class Coordinator:NSObject {var renderer:ArtworkRenderer?;@objc func tap(){renderer?.interact()}}
}
