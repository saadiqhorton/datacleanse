export interface DeviceLabel {
  browser: string;
  os: string;
  /** "Chrome on macOS", or "Unknown device" when the browser sent no user agent. */
  label: string;
}

/**
 * Coarse browser and OS names from a User-Agent string. Order matters: Chrome and Edge both contain
 * "Safari", Android contains "Linux", and iPhone user agents contain "Mac OS X".
 */
export function describeUserAgent(ua: string): DeviceLabel {
  if (!ua.trim()) return { browser: "Unknown browser", os: "Unknown OS", label: "Unknown device" };

  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Unknown browser";

  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown OS";

  return { browser, os, label: browser === "Unknown browser" ? os : `${browser} on ${os}` };
}
