# Native runtime dependency

Spine C++ 3.8 is used only for skeleton parsing and animation evaluation. Swift/Metal supplies rendering; SwiftUI supplies the app interface.

- Upstream: https://github.com/EsotericSoftware/spine-runtimes
- Pinned revision: `8b4844bd4b193ba9e54487ed397a777993cbad56`
- Source subtree: `spine-cpp/spine-cpp`
- License: the upstream `LICENSE` at that exact revision. Preparation retains source copyright notices, writes `build/ios/SPINE-LICENSE` and includes `SPINE-LICENSE` in the sample resource folder bundled with the app.

Spine's runtime license is separate from this repository's license. Review the upstream license and its editor/runtime licensing conditions before distributing an application. Downloaded third-party sources are cached in ignored build directories and are not vendored into this repository.

Source code includes no game artwork. The app can use a small locally prepared sample pack and download additional artwork from a configured resource service. Resource rights remain with their respective owners.
