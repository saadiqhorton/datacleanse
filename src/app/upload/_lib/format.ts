const COUNT = new Intl.NumberFormat("en-US");

/** "512 B", "340 KB", "2.1 MB", "200 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
  return `${Number((bytes / (1024 * 1024 * 1024)).toFixed(1))} GB`;
}

/** "4,812". */
export function formatCount(n: number): string {
  return COUNT.format(n);
}
