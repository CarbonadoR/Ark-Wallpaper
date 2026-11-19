#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
NS_ASSUME_NONNULL_BEGIN
@interface SpineDrawBatch : NSObject
@property(nonatomic,copy) NSData *vertices;
@property(nonatomic,copy) NSData *indices;
@property(nonatomic,copy) NSString *page;
@property(nonatomic) NSInteger blendMode;
@end
@interface SpineBridge : NSObject
@property(nonatomic,readonly) NSArray<NSString *> *animations;
@property(nonatomic,readonly) CGRect bounds;
- (nullable instancetype)initWithAtlasURL:(NSURL *)atlasURL skeletonURL:(NSURL *)skeletonURL binary:(BOOL)binary error:(NSError **)error;
- (NSArray<SpineDrawBatch *> *)update:(float)delta;
- (void)play:(NSString *)name loop:(BOOL)loop;
- (void)queue:(NSString *)name;
@end
NS_ASSUME_NONNULL_END
