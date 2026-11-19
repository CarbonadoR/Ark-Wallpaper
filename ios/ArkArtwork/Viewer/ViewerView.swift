import SwiftUI
struct ViewerView: View {
 @StateObject private var model=ViewerModel()
 @Environment(\.scenePhase) private var phase
 @State private var modelsOpen=false
 @State private var backgroundsOpen=false
 @State private var exportOpen=false
 @State private var downloadsOpen=false
 @State private var typeFilter="all"
 @State private var search=""
 @State private var dragOrigin:CGSize?
 @State private var pinchOrigin:CGFloat?
 var body:some View {
  ZStack(alignment:.bottom){
   ArtworkMetalView(model:model,active:phase == .active)
    .ignoresSafeArea()
    .simultaneousGesture(DragGesture(minimumDistance:4).onChanged{v in if dragOrigin==nil{dragOrigin=model.offset};model.offset=CGSize(width:dragOrigin!.width+v.translation.width,height:dragOrigin!.height+v.translation.height)}.onEnded{_ in dragOrigin=nil})
    .simultaneousGesture(MagnifyGesture().onChanged{v in if pinchOrigin==nil{pinchOrigin=model.scale};model.scale=min(4,max(0.25,pinchOrigin!*v.magnification))}.onEnded{_ in pinchOrigin=nil})
   VStack(spacing:12){
    HStack(alignment:.top){
     VStack(alignment:.leading,spacing:4){Text("ARK / ARTWORK").font(.caption.monospaced()).tracking(2).foregroundStyle(.white.opacity(0.65));Text(model.model?.name ?? "立绘查看器").font(.title2.bold());Text(model.model?.outfit ?? "正在载入").font(.caption).lineLimit(1).foregroundStyle(.white.opacity(0.7))}
     Spacer()
     Button{downloadsOpen=true}label:{Image(systemName:"arrow.down.circle").font(.title2)}.accessibilityLabel("资源下载与更新").accessibilityIdentifier("resource-downloads")
     Text(model.model?.mediaType == "spine" ? "动态" : "静态").font(.caption.bold()).padding(.horizontal,12).padding(.vertical,7).background(.ultraThinMaterial,in:Capsule())
    }.padding(18).background(.black.opacity(0.3),in:RoundedRectangle(cornerRadius:22))
    Spacer()
    if let error=model.error {Text(error).font(.callout).padding().background(.red.opacity(0.8),in:RoundedRectangle(cornerRadius:12)).accessibilityIdentifier("error")}
    HStack(spacing:0){
     control("人物",icon:"person.crop.rectangle",id:"models"){modelsOpen=true}
     control("背景",icon:"photo",id:"backgrounds"){backgroundsOpen=true}
     if model.model?.mediaType == "spine" {control(model.paused ? "播放":"暂停",icon:model.paused ? "play.fill":"pause.fill",id:"pause"){model.paused.toggle()}}
     control("复位",icon:"arrow.counterclockwise",id:"reset"){model.reset()}
     control("壁纸",icon:"livephoto",id:"export"){exportOpen=true}.disabled(model.loadedID != model.selectedID || model.error != nil)
    }.padding(.vertical,12).background(.ultraThinMaterial,in:RoundedRectangle(cornerRadius:24))
   }.padding(.horizontal,18).padding(.vertical,10)
  }.foregroundStyle(.white).preferredColorScheme(.dark)
   .task{model.load()}
   .sheet(isPresented:$exportOpen){WallpaperExportView(viewer:model)}
   .sheet(isPresented:$downloadsOpen){ResourceDownloadView(viewer:model)}
   .sheet(isPresented:$modelsOpen){NavigationStack {List {
    Picker("类型",selection:$typeFilter){Text("全部").tag("all");Text("动态").tag("spine");Text("静态").tag("image")}.pickerStyle(.segmented)
    ForEach(Array((model.catalog?.models ?? []).enumerated()),id:\.element.id){i,m in
     if (typeFilter == "all" || m.mediaType == typeFilter) && (search.isEmpty || (m.name+m.outfit).localizedCaseInsensitiveContains(search)){Button {model.select(m);modelsOpen=false} label:{HStack{Image(systemName:m.mediaType=="spine" ? "play.rectangle":"photo").font(.title2);VStack(alignment:.leading){Text(m.name).font(.headline);Text(m.outfit).font(.caption).foregroundStyle(.secondary)};Spacer();if m.id==model.selectedID{Image(systemName:"checkmark")}}.padding(.vertical,8)}.accessibilityIdentifier("model-\(i)").accessibilityValue(m.id)}
    }
   }.searchable(text:$search,prompt:"搜索人物或造型").navigationTitle("立绘").toolbar{Button("完成"){modelsOpen=false}}}.presentationDetents([.large])}
   .sheet(isPresented:$backgroundsOpen){NavigationStack{List {
    ColorPicker("背景颜色",selection:$model.backgroundColor,supportsOpacity:false)
    Button("纯色背景"){model.backgroundID="";backgroundsOpen=false}.accessibilityIdentifier("background-none")
    ForEach(Array((model.catalog?.backgrounds ?? []).enumerated()),id:\.element.id){i,b in Button(b.name){model.backgroundID=b.id;backgroundsOpen=false}.accessibilityIdentifier("background-\(i)")}
   }.navigationTitle("背景").toolbar{Button("完成"){backgroundsOpen=false}}}.presentationDetents([.medium])}
 }
 private func control(_ title:String,icon:String,id:String,action:@escaping()->Void)->some View {Button(action:action){VStack(spacing:5){Image(systemName:icon).font(.system(size:18));Text(title).font(.caption)}.frame(maxWidth:.infinity).contentShape(Rectangle())}.buttonStyle(.plain).accessibilityIdentifier(id)}
}
