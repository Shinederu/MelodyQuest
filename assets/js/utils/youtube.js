export function extractYouTubeVideoId(value) {
  const input = String(value || "").trim();
  if (!input) return "";

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

export function buildYouTubeEmbedUrl(videoId) {
  const normalizedVideoId = String(videoId || "").trim();
  if (!normalizedVideoId) return "";
  return `https://www.youtube.com/embed/${encodeURIComponent(normalizedVideoId)}`;
}
