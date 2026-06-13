let youtubeIframeApiPromise = null;

export function loadYouTubeIframeApi(timeoutMs = 15000) {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeoutId = window.setTimeout(() => reject(new Error("YouTube iframe API timeout")), timeoutMs);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      if (typeof previousReady === "function") {
        previousReady();
      }
      resolve(window.YT);
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("YouTube iframe API load failed"));
    };
    document.head.appendChild(script);
  });

  return youtubeIframeApiPromise;
}

export function extractYouTubeVideoId(value) {
  const input = String(value || "").trim();
  if (!input) return "";

  if (/^[A-Za-z0-9_-]{6,32}$/.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0]?.trim() || "";
    }
    if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      if (url.searchParams.get("v")) {
        return String(url.searchParams.get("v") || "").trim();
      }
      const segments = url.pathname.split("/").filter(Boolean);
      const embedIndex = segments.findIndex((segment) => segment === "embed" || segment === "shorts");
      if (embedIndex >= 0 && segments[embedIndex + 1]) {
        return segments[embedIndex + 1].trim();
      }
    }
    if (hostname === "music.youtube.com" && url.searchParams.get("v")) {
      return String(url.searchParams.get("v") || "").trim();
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
