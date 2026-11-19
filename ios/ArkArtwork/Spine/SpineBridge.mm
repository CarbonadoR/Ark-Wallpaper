#import "SpineBridge.h"
#include <spine/spine.h>
#include <memory>
#include <vector>
#include <cmath>
using namespace spine;
namespace spine { SpineExtension *getDefaultExtension() { return new DefaultSpineExtension(); } }
@implementation SpineDrawBatch
@end
struct Vertex { float x,y,u,v,r,g,b,a,dr,dg,db,da; };
static_assert(sizeof(Vertex)==48,"Metal vertex layout");
@implementation SpineBridge {
 std::unique_ptr<Atlas> _atlas;
 std::unique_ptr<SkeletonData> _data;
 std::unique_ptr<AnimationStateData> _stateData;
 std::unique_ptr<AnimationState> _state;
 std::unique_ptr<Skeleton> _skeleton;
 std::unique_ptr<SkeletonClipping> _clip;
 NSArray<NSString *> *_animations;
 CGRect _bounds;
}
- (instancetype)initWithAtlasURL:(NSURL *)atlasURL skeletonURL:(NSURL *)skeletonURL binary:(BOOL)binary error:(NSError **)error {
 if(!(self=[super init]))return nil;
 if(![NSData dataWithContentsOfURL:atlasURL] || ![NSData dataWithContentsOfURL:skeletonURL]) {
  if(error)*error=[NSError errorWithDomain:@"Spine" code:1 userInfo:@{NSLocalizedDescriptionKey:@"骨骼或图集文件不存在"}];return nil;
 }
 _atlas.reset(new Atlas(atlasURL.fileSystemRepresentation,nullptr,false));
 String message;
 if(binary){SkeletonBinary parser(_atlas.get());_data.reset(parser.readSkeletonDataFile(skeletonURL.fileSystemRepresentation));message=parser.getError();}
 else {SkeletonJson parser(_atlas.get());_data.reset(parser.readSkeletonDataFile(skeletonURL.fileSystemRepresentation));message=parser.getError();}
 if(!_data){if(error)*error=[NSError errorWithDomain:@"Spine" code:2 userInfo:@{NSLocalizedDescriptionKey:message.buffer()?@(message.buffer()):@"骨骼解析失败"}];return nil;}
 _skeleton.reset(new Skeleton(_data.get()));_stateData.reset(new AnimationStateData(_data.get()));_state.reset(new AnimationState(_stateData.get()));_clip.reset(new SkeletonClipping());
 NSMutableArray *names=[NSMutableArray array];for(size_t i=0;i<_data->getAnimations().size();i++)[names addObject:@(_data->getAnimations()[i]->getName().buffer())];_animations=names;
 _skeleton->updateWorldTransform();float x=0,y=0,w=0,h=0;Vector<float> buffer;_skeleton->getBounds(x,y,w,h,buffer);
 _bounds=CGRectMake(x,y,std::max(1.f,w),std::max(1.f,h));return self;
}
- (NSArray<NSString *> *)animations{return _animations;}
- (CGRect)bounds{return _bounds;}
- (void)play:(NSString *)name loop:(BOOL)loop {if(_data->findAnimation(name.UTF8String))_state->setAnimation(0,name.UTF8String,loop);}
- (void)queue:(NSString *)name {if(_data->findAnimation(name.UTF8String))_state->addAnimation(0,name.UTF8String,true,0);}
- (NSArray<SpineDrawBatch *> *)update:(float)delta {
 _state->update(std::max(0.f,std::min(delta,1.f)));_state->apply(*_skeleton);_skeleton->updateWorldTransform();
 NSMutableArray *batches=[NSMutableArray array];Vector<float> world;
 unsigned short quad[]={0,1,2,2,3,0};
 for(size_t s=0;s<_skeleton->getDrawOrder().size();s++){
  Slot *slot=_skeleton->getDrawOrder()[s];Attachment *a=slot->getAttachment();
  if(!a||!slot->getBone().isActive()){_clip->clipEnd(*slot);continue;}
  if(a->getRTTI().isExactly(ClippingAttachment::rtti)){_clip->clipStart(*slot,(ClippingAttachment*)a);continue;}
  float *uv=nullptr;unsigned short *indices=nullptr;size_t count=0;AtlasRegion *region=nullptr;Color tint;
  if(a->getRTTI().isExactly(RegionAttachment::rtti)){auto *r=(RegionAttachment*)a;world.setSize(8,0);r->computeWorldVertices(slot->getBone(),world,0,2);uv=r->getUVs().buffer();indices=quad;count=6;region=(AtlasRegion*)r->getRendererObject();tint=r->getColor();}
  else if(a->getRTTI().isExactly(MeshAttachment::rtti)){auto *m=(MeshAttachment*)a;world.setSize(m->getWorldVerticesLength(),0);m->computeWorldVertices(*slot,world);uv=m->getUVs().buffer();indices=m->getTriangles().buffer();count=m->getTriangles().size();region=(AtlasRegion*)m->getRendererObject();tint=m->getColor();}
  else {_clip->clipEnd(*slot);continue;}
  float *xy=world.buffer();size_t length=world.size();
  if(_clip->isClipping()){_clip->clipTriangles(xy,indices,count,uv,2);xy=_clip->getClippedVertices().buffer();length=_clip->getClippedVertices().size();uv=_clip->getClippedUVs().buffer();indices=_clip->getClippedTriangles().buffer();count=_clip->getClippedTriangles().size();}
  if(region&&length&&count){
   auto c=_skeleton->getColor();auto sc=slot->getColor();float alpha=c.a*sc.a*tint.a;
   Color dark=slot->hasDarkColor()?slot->getDarkColor():Color(0,0,0,0);
   std::vector<Vertex> vertices;vertices.reserve(length/2);bool valid=true;
   for(size_t i=0;i<length;i+=2){if(!std::isfinite(xy[i])||!std::isfinite(xy[i+1])){valid=false;break;}vertices.push_back({xy[i],xy[i+1],uv[i],uv[i+1],c.r*sc.r*tint.r,c.g*sc.g*tint.g,c.b*sc.b*tint.b,alpha,dark.r,dark.g,dark.b,1});}
   if(valid){SpineDrawBatch *batch=[SpineDrawBatch new];batch.vertices=[NSData dataWithBytes:vertices.data() length:vertices.size()*sizeof(Vertex)];batch.indices=[NSData dataWithBytes:indices length:count*sizeof(unsigned short)];batch.page=@(region->page->name.buffer());batch.blendMode=slot->getData().getBlendMode();[batches addObject:batch];}
  }
  _clip->clipEnd(*slot);
 }
 _clip->clipEnd();return batches;
}
@end
