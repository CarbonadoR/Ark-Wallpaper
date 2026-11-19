import SwiftUI

@MainActor final class ResourceDownloadModel:ObservableObject {
 @Published var url:String
 @Published var packs:[RemoteResourcePack]=[]
 @Published var progress:Double=0
 @Published var receivedBytes:Int64=0
 @Published var expectedBytes:Int64=0
 @Published var message=""
 @Published var busy=false
 @Published var installed:[String:String]=NativeResourceStore.standard.installed()
 private var operation:Task<Void,Never>?
 private var provider:HTTPResourceProvider?
 init(){
  let bundled=Bundle.main.url(forResource:"ResourceServer",withExtension:"json").flatMap{try? Data(contentsOf:$0)}.flatMap{try? JSONDecoder().decode([String:String].self,from:$0)}?["url"] ?? ""
  url=UserDefaults.standard.string(forKey:"resourceServerURL") ?? bundled
 }
 var total:Int64{packs.compactMap(\.ios).reduce(0){$0+$1.totalBytes}}
 func check(){
  guard !busy else{return};busy=true;message="正在检查资源目录…"
  operation=Task{
   defer{busy=false}
   do{guard let source=URL(string:url.trimmingCharacters(in:.whitespacesAndNewlines)) else{throw ResourceError.unsafePath}
    let next=try HTTPResourceProvider(source:source,root:NativeResourceStore.standard.root),feed=try await next.feed(refresh:true)
    provider=next;packs=feed.packs.filter{$0.ios != nil};UserDefaults.standard.set(url,forKey:"resourceServerURL");message="已获取 \(packs.count) 个资源包";progress=0
   }catch{message=error.localizedDescription}
  }
 }
 func download(_ chosen:[RemoteResourcePack],viewer:ViewerModel){
  guard !busy,let provider else{return};busy=true;progress=0;receivedBytes=0;expectedBytes=chosen.compactMap(\.ios).reduce(0){$0+$1.totalBytes}
  operation=Task{
   defer{busy=false;installed=NativeResourceStore.standard.installed();viewer.reloadResources()}
   do{
    var completedBytes:Int64=0
    for (i,pack) in chosen.enumerated(){
     try Task.checkCancellation();guard let descriptor=pack.ios else{continue};message="\(pack.name) · \(i+1)/\(chosen.count)"
     let base=completedBytes
     _ = try await provider.install(packID:descriptor.id){value in
      Task{@MainActor in self.receivedBytes=base+value.receivedBytes;self.progress=Double(self.receivedBytes)/Double(max(1,self.expectedBytes))}
     }
     completedBytes+=descriptor.totalBytes;receivedBytes=completedBytes;progress=Double(receivedBytes)/Double(max(1,expectedBytes))
    };progress=1;message="下载完成，资源已缓存"
   }catch{message=Task.isCancelled ? "已取消，完成的资源已保留":error.localizedDescription}
  }
 }
 func cancel(){operation?.cancel()}
}
struct ResourceDownloadView:View {
 @ObservedObject var viewer:ViewerModel
 @StateObject private var download=ResourceDownloadModel()
 @Environment(\.dismiss) private var dismiss
 @State private var search=""
 var body:some View{
  NavigationStack{List{
   Section("资源服务"){
    TextField("https://资源服务地址/",text:$download.url).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).disabled(download.busy).accessibilityIdentifier("resource-url")
    Button("检查更新"){download.check()}.disabled(download.busy).accessibilityIdentifier("resource-check")
   }
   Section{
    Button("下载全部精简资源"){download.download(download.packs,viewer:viewer)}.disabled(download.busy||download.packs.isEmpty).accessibilityIdentifier("resource-download-all")
    Button("更新已缓存资源"){download.download(download.packs.filter{download.installed[$0.ios!.id] != nil},viewer:viewer)}.disabled(download.busy||download.packs.isEmpty)
    Text("全部原生立绘与背景，最多 \(ByteCountFormatter.string(fromByteCount:download.total,countStyle:.file))。已缓存文件会复用。内置测试包保持可用。").font(.caption).foregroundStyle(.secondary)
    if download.busy{ProgressView(value:download.progress);Text("\(ByteCountFormatter.string(fromByteCount:download.receivedBytes,countStyle:.file)) / \(ByteCountFormatter.string(fromByteCount:download.expectedBytes,countStyle:.file))").font(.caption);Button("取消下载",role:.cancel){download.cancel()}.accessibilityIdentifier("resource-cancel")}
    if !download.message.isEmpty{Text(download.message).font(.callout).accessibilityIdentifier("resource-status")}
   }
   Section("按人物或背景下载"){
    ForEach(download.packs.filter{search.isEmpty||$0.name.localizedCaseInsensitiveContains(search)}){pack in
     Button{download.download([pack],viewer:viewer)}label:{HStack{VStack(alignment:.leading){Text(pack.name);Text(ByteCountFormatter.string(fromByteCount:pack.ios!.totalBytes,countStyle:.file)).font(.caption).foregroundStyle(.secondary)};Spacer();Image(systemName:download.installed[pack.ios!.id]==pack.ios!.sha256 ? "checkmark.circle":"arrow.down.circle")}}.disabled(download.busy).accessibilityIdentifier("download-"+pack.id).accessibilityValue(download.installed[pack.ios!.id]==pack.ios!.sha256 ? "cached":"available")
    }
   }
  }.searchable(text:$search,prompt:"搜索人物或背景").navigationTitle("资源下载").toolbar{Button("完成"){dismiss()}.disabled(download.busy)}.interactiveDismissDisabled(download.busy)}
 }
}
