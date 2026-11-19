# Resource delivery

macOS and Windows share the local Node resource client. Open **资源下载与更新** from the native menu or the viewer. Configure the public HTTPS resource service, check the catalog, then browse characters normally: model requests cache the corresponding character pack. The catalog includes characters that have not been downloaded. Previously installed packs remain available offline.

All platforms provide **下载全部精简资源**, **更新已缓存资源**, progress and cancellation. Full download on desktop includes the entire pruned resource collection. On iOS it includes the native-compatible illustrations and backgrounds; battle models, portraits and desktop clock assets are outside the iOS app's scope. Downloads reuse verified blobs. Desktop also reuses matching files from configured local resource directories after verifying their sizes and hashes. Cancellation preserves completed packs; retry reuses completed files.

For desktop configuration before first launch, copy `config/resources.example.json` to ignored `config/resources.local.json` and set `url`. `ARKNIGHTS_RESOURCE_SERVER` is also supported. The local cache is `.resource-cache/`, never a Git asset. Original resource directories are not overwritten. When no local resources exist, a configured download service permits startup with an empty local catalog.

iOS exposes the resource library from the download icon above the artwork. Download individual characters/backgrounds or the full native catalog. Installed packs merge with the small bundled sample pack. The build generator includes the URL from ignored local configuration in a generated `ResourceServer.json`; personal values are not written into source files. Users can override the URL in the app. Downloaded files live in Application Support.

## Public protocol

- `feed.json`: schema version 1, release identifier, complete desktop catalog, backgrounds and pack descriptors. A descriptor contains `id`, manifest `sha256`, manifest `bytes`, and payload `totalBytes`.
- `manifests/<sha256>.json`: immutable pack manifest, listing relative paths, SHA-256 and byte length for each file. Desktop packs preserve scanner paths and portable model IDs; native packs include normalized textures and the native catalog schema.
- `blobs/<sha256>`: immutable file content, shared by all packs and both formats.

Clients require HTTPS in production, reject redirects and unsafe paths, verify lengths and hashes, stage complete packs, then replace the installed index atomically. The publisher serves only resource data; the local viewer's write APIs are not exposed publicly.

## Local desktop API

| Endpoint | Meaning |
| --- | --- |
| `GET /api/resources/status` | Configured source, catalog release, cache counts and download progress |
| `PUT /api/resources/settings` | JSON `{ "url": "https://…/" }` |
| `POST /api/resources/check` | Refresh the catalog, retain the last usable catalog on network failure |
| `POST /api/resources/download` | JSON `{ "mode": "all" }` or `{ "mode": "cached" }`; starts a background job |
| `POST /api/resources/cancel` | Cancel the active batch, preserve completed files |

Mutation endpoints accept same-origin loopback JSON requests. Model, background and clock read endpoints acquire missing packs on demand. The native macOS/Windows menus open the shared resource management interface.

## Publish a release

Prepare a separate pruned resource root containing `arts`, `charpack`, `skinpack`, and `chartable`. Run:

```sh
node scripts/publish-resources.mjs --root PRUNED_ROOT --output build/resource-site
```

Review `feed.json` and its `issues` array before publishing. Upload immutable blobs and manifests first and verify completeness; publish `feed.json` last via an atomic rename. Never upload local configuration, extraction recipes, SSH keys, source credentials, logs or the temporary `native-work` directory. The publisher does not delete older remote generations. Hosting must provide a valid HTTPS certificate with automatic renewal; static file serving supports range requests and immutable caching for blobs/manifests, while the feed must be revalidated.

Keep published generations while devices may still reference them. Cache pruning and remote garbage collection should be deliberate maintenance operations, separate from downloading updates.

## Package application releases

On macOS with Xcode and .NET 8 installed, commit the intended source changes and run `npm run release:package`. Supply the public resource service through ignored `config/resources.local.json` or `ARKNIGHTS_RELEASE_RESOURCE_SERVER`. Set `ARKNIGHTS_DOTNET` when the .NET executable is not in PATH. Optional `-- --targets=windows-x64,windows-arm64,macos-universal,ios-simulator-arm64` selects artifacts.

The packager uses `git archive HEAD`, compiled frontend files and platform binaries. Untracked plans and local resources are not copied. Desktop packages contain a generated `resources.release.json`; first launch initializes local settings without replacing an existing resource source. Windows and macOS need Node.js/npm; the launcher installs locked dependencies and applies the Spine patch. macOS is a universal, ad-hoc signed build. The iOS artifact is an Apple Silicon simulator app with the small prepared sample pack, not a device-signed IPA. Every artifact has a source commit record and an entry in `SHA256SUMS.txt`.
