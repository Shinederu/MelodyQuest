import { getCurrentLobby, setCurrentLobby, clearCurrentLobby } from "../utils/LobbyState.js";

const AUTO_RETURN_DELAY_SECONDS = 15;

export class ResultController {
  constructor() {
    this.currentLobby = getCurrentLobby();
    this.heartbeatInterval = null;
    this.countdownInterval = null;
    this.isDestroyed = false;
    this.returnInFlight = false;
    this.countdownRemaining = AUTO_RETURN_DELAY_SECONDS;
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
    this.startAutoReturnCountdown();
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
    this.stopAutoReturnCountdown();
    this.setStatus("Reinitialisation du lobby...", null);

    const res = await window.httpClient.resetLobbyForReplay(lobbyId);
    this.returnInFlight = false;

    if (!res.success || !res.data?.lobby) {
      if (this.shouldExitLobby(res.error)) {
        this.exitLobbyIfActive();
        return;
      }

      this.startAutoReturnCountdown();
      this.setStatus(res.error || "Impossible de reinitialiser le lobby", false);
      return;
    }

    this.currentLobby = res.data.lobby;
    setCurrentLobby(res.data.lobby);
    localStorage.removeItem("mq_last_scoreboard");
    this.setStatus("Lobby reinitialise", true);
    window.appCtrl.changeView("lobby");
  }

  startAutoReturnCountdown() {
    this.stopAutoReturnCountdown();
    this.countdownRemaining = AUTO_RETURN_DELAY_SECONDS;
    this.renderCountdown();

    this.countdownInterval = setInterval(() => {
      if (this.isDestroyed || this.returnInFlight) {
        return;
      }

      this.countdownRemaining = Math.max(0, this.countdownRemaining - 1);
      this.renderCountdown();

      if (this.countdownRemaining <= 0) {
        this.returnToLobby();
      }
    }, 1000);
  }

  stopAutoReturnCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  renderCountdown() {
    const el = document.getElementById("result-countdown");
    if (!el) return;
    el.textContent = `Retour automatique au lobby dans ${this.countdownRemaining}s`;
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
    this.stopAutoReturnCountdown();
  }
}
