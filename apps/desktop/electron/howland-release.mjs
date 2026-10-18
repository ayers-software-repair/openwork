// Copyright Ayers Electronics Inc.
//
// The names Howland's release train publishes per platform and architecture, as declared in
// packaging/platforms.json. The architecture banner and version recovery both read them here.

function archSlug(arch) {
  return arch === "arm64" ? "arm64" : "x64";
}

// Installer names carry no version: the release tag in the download path pins it.
export function howlandAssetName(platform, arch) {
  if (platform === "darwin") return `Howland-Desktop-macOS-${archSlug(arch)}.dmg`;
  if (platform === "win32") return `Howland-Desktop-Windows-${archSlug(arch)}.exe`;
  return `Howland-Desktop-Linux-${archSlug(arch)}.AppImage`;
}

// electron-updater appends "-mac" or "-linux[-arch]" to the channel itself
// (Provider.getCustomChannelName), so only the two legs whose file differs from its default need
// their own channel: Windows arm64 reads latest-arm64.yml and Intel macOS reads latest-x64-mac.yml.
export function howlandManifestChannel(platform, arch, base = "latest") {
  if (platform === "win32" && arch === "arm64") return `${base}-arm64`;
  if (platform === "darwin" && arch !== "arm64") return `${base}-x64`;
  return base;
}

// The channel file electron-updater fetches for that channel, by Provider.getChannelFilePrefix.
export function howlandManifestFile(platform, arch, base = "latest") {
  const channel = howlandManifestChannel(platform, arch, base);
  if (platform === "darwin") return `${channel}-mac.yml`;
  if (platform === "win32") return `${channel}.yml`;
  return `${channel}-linux${arch === "x64" ? "" : `-${arch}`}.yml`;
}
