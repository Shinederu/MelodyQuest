export function getCurrentLobby() {
  try {
    const raw = localStorage.getItem("mq_current_lobby");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCurrentLobby(lobby) {
  if (!lobby) return;
  const payload = {
    id: Number(lobby.id || 0),
    lobby_code: String(lobby.lobby_code || "").toUpperCase(),
    name: String(lobby.name || ""),
  };
  localStorage.setItem("mq_current_lobby", JSON.stringify(payload));
}

export function clearCurrentLobby() {
  localStorage.removeItem("mq_current_lobby");
}
