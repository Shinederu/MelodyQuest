import { setCurrentLobby } from "../utils/LobbyState.js";

export class LobbyListController {
  constructor() {
    this.liveInterval = null;
    this.isRefreshing = false;
    this.visibilityHandler = () => {
      if (!document.hidden) {
        this.refresh(true);
      }
    };

    document.getElementById("btn-lobbylist-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-lobbylist-join")?.addEventListener("click", () => this.joinByCode());
    document.getElementById("btn-lobbylist-back")?.addEventListener("click", () => window.appCtrl.changeView("main"));
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.refresh();
    this.startLiveRefresh();
  }

  startLiveRefresh() {
    this.stopLiveRefresh();
    this.liveInterval = setInterval(() => this.refresh(true), 3000);
  }

  stopLiveRefresh() {
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = null;
    }
  }

  async refresh(silent = false) {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    try {
      const res = await window.httpClient.listPublicLobbies();
      const status = document.getElementById("lobbylist-status");
      const list = document.getElementById("lobbylist-items");

      if (!status || !list) return;

      if (!res.success) {
        status.textContent = res.error || "Erreur chargement lobbies";
        status.className = "status error";
        return;
      }

      if (!silent) {
        status.textContent = "Lobbies charges";
        status.className = "status success";
      }

      const items = res.data?.items ?? [];
      list.innerHTML = items
        .map((x) => `<li><button type="button" data-code="${x.lobby_code}" class="btn-join-public">${x.name} (${x.lobby_code}) - ${x.players_count}/${x.max_players}</button></li>`)
        .join("");

      list.querySelectorAll(".btn-join-public").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const code = btn.getAttribute("data-code") || "";
          await this.join(code);
        });
      });
    } finally {
      this.isRefreshing = false;
    }
  }

  async joinByCode() {
    const code = String(document.getElementById("lobbylist-code")?.value ?? "").trim().toUpperCase();
    if (!code) {
      this.setStatus("Code requis", false);
      return;
    }
    await this.join(code);
  }

  async join(code) {
    const joinRes = await window.httpClient.joinLobby(code);
    if (!joinRes.success) {
      this.setStatus(joinRes.error || "Echec join", false);
      return;
    }

    const detail = await window.httpClient.getLobbyByCode(code);
    if (!detail.success || !detail.data?.lobby) {
      this.setStatus(detail.error || "Echec recup lobby", false);
      return;
    }

    setCurrentLobby(detail.data.lobby);
    this.setStatus("Lobby rejoint", true);
    window.appCtrl.changeView("lobby");
  }

  setStatus(text, ok) {
    const status = document.getElementById("lobbylist-status");
    if (!status) return;
    status.textContent = text;
    status.className = ok ? "status success" : "status error";
  }

  destroy() {
    this.stopLiveRefresh();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}
