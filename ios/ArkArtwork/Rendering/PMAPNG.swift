import Foundation
import Compression

// Resource-pack PMA pages are normalized to non-interlaced 8-bit RGBA PNG.
// ImageIO premultiplies these a second time on iOS; decode their bytes directly.
enum PMAPNG {
 static func decode(_ data:Data) throws -> (width:Int,height:Int,pixels:[UInt8]) {
  let bytes=[UInt8](data)
  guard bytes.count >= 33,Array(bytes.prefix(8)) == [137,80,78,71,13,10,26,10] else {throw ResourceError.invalidManifest}
  func uint32(_ i:Int)->Int {Int(bytes[i])<<24 | Int(bytes[i+1])<<16 | Int(bytes[i+2])<<8 | Int(bytes[i+3])}
  var offset=8,width=0,height=0,compressed=[UInt8](),ended=false
  while offset+12 <= bytes.count {
   let length=uint32(offset)
   guard length <= bytes.count-offset-12 else {throw ResourceError.invalidManifest}
   let type=String(bytes:bytes[(offset+4)..<(offset+8)],encoding:.ascii)
   let start=offset+8
   if type == "IHDR" {
    guard offset == 8,length == 13 else {throw ResourceError.invalidManifest}
    width=uint32(start);height=uint32(start+4)
    guard width>0,height>0,width<=16384,height<=16384,width*height<=16_777_216,
      bytes[start+8] == 8,bytes[start+9] == 6,bytes[start+10] == 0,bytes[start+11] == 0,bytes[start+12] == 0 else {throw ResourceError.invalidManifest}
   } else if type == "IDAT" {compressed.append(contentsOf:bytes[start..<(start+length)])}
   else if type == "IEND" {ended=true;break}
   offset += length+12
  }
  guard ended,width>0,height>0,compressed.count>6 else {throw ResourceError.invalidManifest}
  let stride=width*4,expected=(stride+1)*height
  var packed=[UInt8](repeating:0,count:expected)
  // Compression's ZLIB algorithm consumes RFC1951 data without RFC1950 framing.
  let count=packed.withUnsafeMutableBytes {out in compressed.withUnsafeBytes {input in
   compression_decode_buffer(out.bindMemory(to:UInt8.self).baseAddress!,expected,input.bindMemory(to:UInt8.self).baseAddress!.advanced(by:2),compressed.count-6,nil,COMPRESSION_ZLIB)
  }}
  guard count == expected else {throw ResourceError.invalidManifest}
  var pixels=[UInt8](repeating:0,count:width*height*4)
  func paeth(_ a:Int,_ b:Int,_ c:Int)->Int {
   let p=a+b-c,pa=abs(p-a),pb=abs(p-b),pc=abs(p-c)
   return pa<=pb && pa<=pc ? a : pb<=pc ? b : c
  }
  for y in 0..<height {
   let source=y*(stride+1),row=y*stride,filter=packed[source]
   guard filter<=4 else {throw ResourceError.invalidManifest}
   for x in 0..<stride {
    let a=x>=4 ? Int(pixels[row+x-4]) : 0
    let b=y>0 ? Int(pixels[row+x-stride]) : 0
    let c=x>=4 && y>0 ? Int(pixels[row+x-stride-4]) : 0
    let predictor=filter==1 ? a : filter==2 ? b : filter==3 ? (a+b)/2 : filter==4 ? paeth(a,b,c) : 0
    pixels[row+x]=UInt8((Int(packed[source+1+x])+predictor)&255)
   }
  }
  return (width,height,pixels)
 }
}
