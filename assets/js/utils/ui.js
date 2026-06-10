export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function slugify(value) {
  return normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatDate(value, fallback = "date inconnue") {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("fr-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatRank(rank) {
  return Number(rank) === 1 ? "1er" : `${rank}e`;
}

export function formatPlayerRole(role) {
  return String(role || "").toLowerCase() === "owner" ? "créateur" : "joueur";
}

export function getInitials(username, fallbackInitials = "J") {
  const parts = String(username || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts.length > 1
    ? `${parts[0][0] || ""}${parts[1][0] || ""}`
    : String(parts[0] || "").slice(0, 2);

  return (letters || fallbackInitials).toUpperCase();
}

export function renderAvatar(player, options = {}) {
  const {
    fallbackName = "joueur",
    fallbackInitials = "J",
    lazy = true,
    ariaHiddenFallback = true,
  } = options;
  const username = String(player?.username || fallbackName);
  const avatarUrl = String(player?.avatar_url || "").trim();

  if (avatarUrl) {
    const loading = lazy ? ' loading="lazy"' : "";
    return `<img class="mq-avatar" src="${escapeAttribute(avatarUrl)}" alt=""${loading} />`;
  }

  const ariaHidden = ariaHiddenFallback ? ' aria-hidden="true"' : "";
  return `<span class="mq-avatar mq-avatar--fallback"${ariaHidden}>${escapeHtml(getInitials(username, fallbackInitials))}</span>`;
}
