import Foundation
protocol ResourceProvider { func catalog() async throws -> ResourceCatalog }
struct LocalResourceProvider: ResourceProvider {
 let root: URL
 func catalog() async throws -> ResourceCatalog { try ResourceCatalog.load(from: root) }
}
struct DownloadProgress: Sendable { let receivedBytes, expectedBytes: Int64 }
protocol DownloadResourceProvider: ResourceProvider {
 func install(packID: String, progress: @escaping @Sendable (DownloadProgress) -> Void) async throws -> URL
 // Implementations must observe Task cancellation, validate hashes and install atomically.
}
struct UnconfiguredDownloadProvider: DownloadResourceProvider {
 func catalog() async throws -> ResourceCatalog { throw ResourceError.downloadNotConfigured }
 func install(packID: String, progress: @escaping @Sendable (DownloadProgress) -> Void) async throws -> URL { throw ResourceError.downloadNotConfigured }
}
