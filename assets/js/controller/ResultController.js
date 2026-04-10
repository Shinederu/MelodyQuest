import { getCurrentLobby, setCurrentLobby, clearCurrentLobby } from "../utils/LobbyState.js";

export class ResultController {
  constructor() {
    this.currentLobby = getCurrentLobby();
    this.heartbeatInterval = null;
    this.isDestroyed = false;
    this.returnInFlight = false;
    document.getElementById("btn-result-continue")?.addEventListener("click", () => this.returnToLobby());
    this.bootstrap();
  }

  async bootstrap() {
    const title = document.getElementById("result-title");
    if (title) title.textContent = this.currentLobby?.name || "Resultats";

    let scoreboard = [];
    try {
      scoreboard = JSON.parse(localStorage.getItem("mq_last_scoreboard") || "[]");
    } catch {
      scoreboard = [];
    }

    if (!scoreboard.length && this.currentLobby?.id) {
      const res = await window.httpClient.getScoreboard(Number(this.currentLobby.id));
      if (res.success) {
        scoreboard = res.data?.items ?? [];
      } else if (this.shouldExitLobby(res.error)) {
        this.exitLobbyIfActive();
        return;
      }
    }

    const list = document.getElementById("result-scoreboard");
    if (!list) return;

    list.innerHTML = scoreboard.map((entry, index) => `
      <li class="mq-list-row">
        <div>
          <strong>#${index + 1} ${this.escapeHtml(entry.username || "joueur")}</strong>
          <span class="mq-muted">${this.escapeHtml(entry.role || "player")}</span>
        </div>
        <span class="mq-chip">${Number(entry.score || 0)} pt</span>
      </li>
    `).join("");

    this.startHeartbeat();
  }

  async returnToLobby() {
    if (this.returnInFlight) {
      return;
    }

    const lobbyId = Number(this.currentLobby?.id || 0);
    if (lobbyId <= 0) {
      window.appCtrl.changeView("main");
      return;
    }

    this.returnInFlight = true;
    this.setStatus("Reinitialisation du lobby...", null);
    this.setContinueDisabled(true);

    const res = await window.httpClient.resetLobbyForReplay(lobbyId);
    this.returnInFlight = false;

    if (!res.success || !res.data?.lobby) {
      if (this.shouldExitLobby(res.error)) {
        this.exitLobbyIfActive();
        return;
      }

      this.setContinueDisabled(false);
      this.setStatus(res.error || "Impossible de reinitialiser le lobby", false);
      return;
    }

    this.currentLobby = res.data.lobby;
    setCurrentLobby(res.data.lobby);
    localStorage.removeItem("mq_last_scoreboard");
    this.setStatus("Lobby reinitialise", true);
    window.appCtrl.changeView("lobby");
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => this.touchPresence(), 15000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async touchPresence() {
    const lobbyId = Number(this.currentLobby?.id || 0);
    if (!lobbyId) return;

    const res = await window.httpClient.touchLobby(lobbyId);
    if (!res.success && this.shouldExitLobby(res.error)) {
      this.exitLobbyIfActive();
    }
  }

  shouldExitLobby(error) {
    const text = String(error || "");
    return /lobby introuvable/i.test(text) || /utilisateur non present/i.test(text);
  }

  exitLobbyIfActive() {
    if (this.isDestroyed) return;
    clearCurrentLobby();
    window.appCtrl.changeView("main");
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  setContinueDisabled(disabled) {
    const button = document.getElementById("btn-result-continue");
    if (button) {
      button.disabled = Boolean(disabled);
    }
  }

  setStatus(text, ok = null) {
    const el = document.getElementById("result-status");
    if (!el) return;
    el.textContent = text || "";
    if (ok === true) {
      el.className = "status success";
      return;
    }
    if (ok === false) {
      el.className = "status error";
      return;
    }
    el.className = "status";
  }

  destroy() {
    this.isDestroyed = true;
    this.stopHeartbeat();
  }
}
