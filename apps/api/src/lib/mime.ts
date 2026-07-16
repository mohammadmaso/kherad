const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

export function guessImageMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return (ext && IMAGE_MIME_TYPES[ext]) || "application/octet-stream";
}
