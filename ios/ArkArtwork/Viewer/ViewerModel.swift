import SwiftUI
@MainActor final class ViewerModel: ObservableObject {
 @Published var catalog: ResourceCatalog?
 @Published var selectedID: String = ""
 @Published var backgroundID: String = ""
 @Published var paused=false
 @Published var scale: CGFloat=1
 @Published var offset: CGSize = .zero
 @Published var error: String?
 @Published var loadedID: String = ""
 @Published var viewport: CGSize = .zero
 @Published var resourceRevision=UUID()
 @Published var backgroundColor: Color = Color(red:0.035,green:0.045,blue:0.065)
 var model: Artwork? { catalog?.models.first{$0.id == selectedID} }
 var background: ArtworkBackground? { catalog?.backgrounds.first{$0.id == backgroundID} }
 func load() {
  do {
   guard let root=Bundle.main.url(forResource:"SamplePack",withExtension:nil) else {throw ResourceError.missingFile}
   if let installed=try? NativeResourceStore.standard.catalog(includeBundle:true){catalog=installed}else{catalog=try ResourceCatalog.load(from:root)};selectedID=catalog?.models.first?.id ?? ""
  } catch {self.error=error.localizedDescription}
 }
 func reloadResources(){
  do{let next=try NativeResourceStore.standard.catalog(includeBundle:true);catalog=next;if !next.models.contains(where:{$0.id==selectedID}){selectedID=next.models.first?.id ?? ""};loadedID="";resourceRevision=UUID();error=nil}catch{self.error=error.localizedDescription}
 }
 func select(_ m: Artwork){selectedID=m.id;paused=false;reset();error=nil}
 func reset(){scale=1;offset = .zero}
 static func idle(_ names:[String])->String? {names.first{$0.range(of:"(^|[_-])(idle|loop)([_-]|$)",options:.regularExpression.union(.caseInsensitive)) != nil} ?? names.first}
 static func interactions(_ names:[String])->[String] {
  let primary=names.filter{$0.range(of:"(^|[^a-z])(interact|special)([^a-z]|$)",options:.regularExpression.union(.caseInsensitive)) != nil}
  return primary.isEmpty ? names.filter{$0.range(of:"(^|[^a-z])(touch|tap|click)([^a-z]|$)",options:.regularExpression.union(.caseInsensitive)) != nil}:primary
 }
}
