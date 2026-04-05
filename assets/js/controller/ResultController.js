import { getCurrentLobby } from "../utils/LobbyState.js";

export class ResultController {
  constructor() {
    this.currentLobby = getCurrentLobby();
    document.getElementById("btn-result-continue")?.addEventListener("click", () => window.appCtrl.changeView("lobby"));
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
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
}
