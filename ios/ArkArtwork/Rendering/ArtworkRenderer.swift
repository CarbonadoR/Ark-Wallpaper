import MetalKit
import ImageIO

@MainActor final class ArtworkRenderer: NSObject, MTKViewDelegate {
 let device: MTLDevice
 let queue: MTLCommandQueue
 private var pipelines: [MTLRenderPipelineState] = []
 private var textures: [String: MTLTexture] = [:]
 private var backgroundTextures: [MTLTexture] = []
 private var skeleton: SpineBridge?
 private var staticTexture: MTLTexture?
 private var bounds=CGRect(x:0,y:0,width:1,height:1)
 private var modelID="", backgroundID=""
 private var lastTime: CFTimeInterval=0
 private var frameIndex=0
 private var vertexBuffers: [MTLBuffer?]=[nil,nil,nil]
 private var indexBuffers: [MTLBuffer?]=[nil,nil,nil]
 private let inflight=DispatchSemaphore(value:3)
 private var exportTexture: MTLTexture?
 weak var state: ViewerModel?
 var selectedKey=""
 init(view: MTKView, state: ViewerModel) throws {
  guard let device=view.device, let queue=device.makeCommandQueue(),let library=device.makeDefaultLibrary() else {throw NSError(domain:"Metal",code:1,userInfo:[NSLocalizedDescriptionKey:"无法初始化原生渲染器"])}
  self.device=device;self.queue=queue;self.state=state;super.init()
  for blend in 0..<4 {
   let descriptor=MTLRenderPipelineDescriptor();descriptor.vertexFunction=library.makeFunction(name:"artworkVertex");descriptor.fragmentFunction=library.makeFunction(name:"artworkFragment")
   let a=descriptor.colorAttachments[0]!;a.pixelFormat=view.colorPixelFormat;a.isBlendingEnabled=true
   a.sourceRGBBlendFactor = blend == 2 ? .destinationColor : .one
   a.destinationRGBBlendFactor = blend == 1 ? .one : blend == 3 ? .oneMinusSourceColor : .oneMinusSourceAlpha
   a.sourceAlphaBlendFactor = .one; a.destinationAlphaBlendFactor = .oneMinusSourceAlpha
   pipelines.append(try device.makeRenderPipelineState(descriptor:descriptor))
  }
 }
 func texture(_ url: URL, mode: String = "straight") throws -> MTLTexture {
  let w:Int,h:Int
  var rgba:[UInt8]
  if mode == "pma" {
   let decoded=try PMAPNG.decode(Data(contentsOf:url));w=decoded.width;h=decoded.height;rgba=decoded.pixels
  } else {
   guard let source=CGImageSourceCreateWithURL(url as CFURL,nil),let image=CGImageSourceCreateImageAtIndex(source,0,nil),image.width<=16384,image.height<=16384 else {throw ResourceError.invalidManifest}
   w=image.width;h=image.height;rgba=[UInt8](repeating:0,count:w*h*4)
   let success=rgba.withUnsafeMutableBytes { bytes -> Bool in
    guard let c=CGContext(data:bytes.baseAddress,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue) else {return false}
    c.draw(image,in:CGRect(x:0,y:0,width:w,height:h));return true
   }
   guard success else {throw ResourceError.invalidManifest}
  }
  let descriptor=MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba8Unorm,width:w,height:h,mipmapped:false);descriptor.usage = .shaderRead
  guard let t=device.makeTexture(descriptor:descriptor) else {throw ResourceError.invalidManifest}
  rgba.withUnsafeBytes {t.replace(region:MTLRegionMake2D(0,0,w,h),mipmapLevel:0,withBytes:$0.baseAddress!,bytesPerRow:w*4)}
  return t
 }
 func load(catalog: ResourceCatalog, model: Artwork) throws {
  try catalog.validate([model.image,model.atlas,model.skeleton].compactMap{$0} + (model.pages ?? []).map(\.path))
  // Build the next scene first. A failed load does not leave a half-created scene.
  var nextTextures: [String:MTLTexture]=[:];var nextSkeleton: SpineBridge?;var nextImage: MTLTexture?;var nextBounds=CGRect.zero
  if model.mediaType == "spine" {
   nextSkeleton=try SpineBridge(atlasURL:catalog.resolve(model.atlas!),skeletonURL:catalog.resolve(model.skeleton!),binary:model.skeletonFormat == "binary")
   for page in model.pages ?? [] {nextTextures[URL(fileURLWithPath:page.path).lastPathComponent]=try texture(catalog.resolve(page.path),mode:page.alphaMode)}
   if let idle=ViewerModel.idle(nextSkeleton!.animations){nextSkeleton!.play(idle,loop:true)}
   _ = nextSkeleton!.update(0);nextBounds=nextSkeleton!.bounds
  } else {nextImage=try texture(catalog.resolve(model.image!));nextBounds=CGRect(x:0,y:0,width:nextImage!.width,height:nextImage!.height)}
  textures=nextTextures;skeleton=nextSkeleton;staticTexture=nextImage;bounds=nextBounds;modelID=model.id;lastTime=0
 }
 func setBackground(catalog:ResourceCatalog,background:ArtworkBackground?) throws {
  let id=(background?.images ?? []).map{image in catalog.root.path+"/"+image+":"+(catalog.files.first(where:{$0.path == image})?.sha256 ?? "")}.joined(separator:"|");guard backgroundID != id else{return}
  try catalog.validate(background?.images ?? [])
  let next=try (background?.images ?? []).map{try texture(catalog.resolve($0))};backgroundTextures=next;backgroundID=id
 }
 func interact(){guard let s=skeleton,let name=ViewerModel.interactions(s.animations).randomElement() else{return};s.play(name,loop:false);if let idle=ViewerModel.idle(s.animations){s.queue(idle)}}
 func mtkView(_ view:MTKView,drawableSizeWillChange size:CGSize){}
 private func quad(_ rect:CGRect, texture:MTLTexture)->SpineDrawBatch {
  let b=SpineDrawBatch();let x=Float(rect.minX),y=Float(rect.minY),r=Float(rect.maxX),top=Float(rect.maxY)
  let v:[Float]=[x,top,0,0,1,1,1,1,0,0,0,1, r,top,1,0,1,1,1,1,0,0,0,1, r,y,1,1,1,1,1,1,0,0,0,1, x,y,0,1,1,1,1,1,0,0,0,1]
  b.vertices=v.withUnsafeBytes{Data($0)};b.indices=[UInt16(0),1,2,2,3,0].withUnsafeBytes{Data($0)};b.blendMode=0;b.page="";return b
 }
 private func buffer(_ current:MTLBuffer?,bytes:Int)->MTLBuffer? {
  if let current,current.length>=bytes{return current}
  return device.makeBuffer(length:max(65536,bytes.nextPowerOfTwo),options:.storageModeShared)
 }
 func draw(in view:MTKView) {
  guard let state else {return}
  view.clearColor=clearColor
  guard let pass=view.currentRenderPassDescriptor,let drawable=view.currentDrawable,let command=queue.makeCommandBuffer() else{return}
  inflight.wait();let signal=inflight;command.addCompletedHandler{_ in signal.signal()}
  guard let encoder=command.makeRenderCommandEncoder(descriptor:pass) else {inflight.signal();return}
  let now=CACurrentMediaTime(),delta=lastTime==0 ? 0 : min(1.0/15,now-lastTime);lastTime=now
  let width=Float(max(1,view.bounds.width)),height=Float(max(1,view.bounds.height))
  if state.viewport != view.bounds.size {state.viewport=view.bounds.size}
  encode(encoder,width:width,height:height,delta:state.paused ? 0 : Float(delta))
  encoder.endEncoding();command.present(drawable);command.commit()
 }
 private var clearColor: MTLClearColor {
  var r:CGFloat=0,g:CGFloat=0,b:CGFloat=0,a:CGFloat=0
  UIColor(state?.backgroundColor ?? .black).getRed(&r,green:&g,blue:&b,alpha:&a)
  return MTLClearColorMake(Double(r),Double(g),Double(b),1)
 }
 // Export owns a separate scene. It advances with fixed time steps and never reads the screen.
 func renderFrame(to pixel:CVPixelBuffer,viewport:CGSize,delta:Float) throws {
  let w=CVPixelBufferGetWidth(pixel),h=CVPixelBufferGetHeight(pixel)
  if exportTexture?.width != w || exportTexture?.height != h {
   let d=MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.bgra8Unorm,width:w,height:h,mipmapped:false)
   d.storageMode = .shared;d.usage = [.renderTarget]
   exportTexture=device.makeTexture(descriptor:d)
  }
  guard let texture=exportTexture,let command=queue.makeCommandBuffer() else {throw WallpaperError.encoding}
  let pass=MTLRenderPassDescriptor();pass.colorAttachments[0].texture=texture
  pass.colorAttachments[0].loadAction = .clear;pass.colorAttachments[0].storeAction = .store;pass.colorAttachments[0].clearColor=clearColor
  guard let encoder=command.makeRenderCommandEncoder(descriptor:pass) else {throw WallpaperError.encoding}
  encode(encoder,width:Float(max(1,viewport.width)),height:Float(max(1,viewport.height)),delta:delta)
  encoder.endEncoding();command.commit();command.waitUntilCompleted()
  guard command.status == .completed else {throw command.error ?? WallpaperError.encoding}
  CVPixelBufferLockBaseAddress(pixel,[])
  defer {CVPixelBufferUnlockBaseAddress(pixel,[])}
  guard let base=CVPixelBufferGetBaseAddress(pixel) else {throw WallpaperError.encoding}
  texture.getBytes(base,bytesPerRow:CVPixelBufferGetBytesPerRow(pixel),from:MTLRegionMake2D(0,0,w,h),mipmapLevel:0)
 }
 private func encode(_ encoder:MTLRenderCommandEncoder,width:Float,height:Float,delta:Float) {
  guard let state else {return}
  var draws:[(SpineDrawBatch,MTLTexture,SIMD4<Float>)]=[]
  if !backgroundTextures.isEmpty {
   let total=backgroundTextures.reduce(0){$0+$1.width},h=backgroundTextures.map(\.height).max()!;let scale=max(width/Float(total),height/Float(h));var x=Float(-total)/2
   for t in backgroundTextures {let b=quad(CGRect(x:CGFloat(x),y:CGFloat(-h)/2,width:CGFloat(t.width),height:CGFloat(h)),texture:t);draws.append((b,t,SIMD4(2*scale/width,2*scale/height,0,0)));x+=Float(t.width)}
  }
  let fit=min(width/Float(bounds.width),height/Float(bounds.height))*0.9*Float(state.scale)
  let transform=SIMD4<Float>(2*fit/width,2*fit/height,-Float(bounds.midX)*2*fit/width+2*Float(state.offset.width)/width,-Float(bounds.midY)*2*fit/height-2*Float(state.offset.height)/height)
  if let skeleton {for b in skeleton.update(delta){if let t=textures[b.page]{draws.append((b,t,transform))}}}
  else if let staticTexture {draws.append((quad(bounds,texture:staticTexture),staticTexture,transform))}
  let slot=frameIndex%3;frameIndex+=1
  let vertexBytes=draws.reduce(0){$0+$1.0.vertices.count},indexBytes=draws.reduce(0){$0+$1.0.indices.count}
  vertexBuffers[slot]=buffer(vertexBuffers[slot],bytes:vertexBytes);indexBuffers[slot]=buffer(indexBuffers[slot],bytes:indexBytes)
  if let vb=vertexBuffers[slot],let ib=indexBuffers[slot] {
   var vo=0,io=0
   for (batch,texture,var transform) in draws {
    batch.vertices.withUnsafeBytes{if let p=$0.baseAddress{memcpy(vb.contents().advanced(by:vo),p,$0.count)}}
    batch.indices.withUnsafeBytes{if let p=$0.baseAddress{memcpy(ib.contents().advanced(by:io),p,$0.count)}}
    encoder.setRenderPipelineState(pipelines[min(3,max(0,batch.blendMode))]);encoder.setVertexBuffer(vb,offset:vo,index:0);encoder.setVertexBytes(&transform,length:16,index:1);encoder.setFragmentTexture(texture,index:0)
    encoder.drawIndexedPrimitives(type:.triangle,indexCount:batch.indices.count/2,indexType:.uint16,indexBuffer:ib,indexBufferOffset:io)
    vo+=batch.vertices.count;io+=batch.indices.count
   }
  }
 }
}
private extension Int { var nextPowerOfTwo:Int {var n=1;while n<self {n*=2};return n} }
