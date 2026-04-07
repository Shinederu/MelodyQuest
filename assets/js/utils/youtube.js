export function extractYouTubeVideoId(value) {
  const input = String(value || "").trim();
  if (!input) return "";

  if (/^[A-Za-z0-9_-]{6,32}$/.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replaceAll("/", "").trim();
    }
    if (url.searchParams.get("v")) {
      return String(url.searchParams.get("v") || "").trim();
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const embedIndex = segments.findIndex((segment) => segment === "embed" || segment === "shorts");
    if (embedIndex >= 0 && segments[embedIndex + 1]) {
      return segments[embedIndex + 1].trim();
    }
  } catch {
    return "";
  }

  return "";
}

export function buildYouTubeWatchUrl(videoId) {
  const normalizedVideoId = extractYouTubeVideoId(videoId);
  if (!normalizedVideoId) return "";
  return `https://www.youtube.com/watch?v=${encodeURIComponent(normalizedVideoId)}`;
}

export function buildYouTubeEmbedUrl(videoId) {
  const normalizedVideoId = extractYouTubeVideoId(videoId);
  if (!normalizedVideoId) return "";
  return `https://www.youtube.com/embed/${encodeURIComponent(normalizedVideoId)}`;
}
