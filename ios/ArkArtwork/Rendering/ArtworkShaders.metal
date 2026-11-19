#include <metal_stdlib>
using namespace metal;
struct Vertex { float2 position; float2 uv; float4 light; float4 dark; };
struct Out { float4 position [[position]]; float2 uv; float4 light; float4 dark; };
vertex Out artworkVertex(uint id [[vertex_id]],const device Vertex *vertices [[buffer(0)]],constant float4 &transform [[buffer(1)]]) {
 Vertex v=vertices[id]; Out o; o.position=float4(v.position*transform.xy+transform.zw,0,1);o.uv=v.uv;o.light=v.light;o.dark=v.dark;return o;
}
fragment float4 artworkFragment(Out in [[stage_in]],texture2d<float> image [[texture(0)]]) {
 constexpr sampler sample(filter::linear,address::clamp_to_edge);
 float4 c=image.sample(sample,in.uv);
 // All uploaded textures are premultiplied; dark tint is the Spine two-color term.
 float3 rgb=(c.rgb*in.light.rgb+(c.a-c.rgb)*in.dark.rgb)*in.light.a;
 return float4(rgb,c.a*in.light.a);
}
