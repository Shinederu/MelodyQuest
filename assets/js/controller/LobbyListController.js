import { setCurrentLobby } from "../utils/LobbyState.js";

export class LobbyListController {
  constructor() {
    this.liveInterval = null;
    this.isRefreshing = false;
    this.stream = null;
    this.lastStreamRevision = 0;

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
    this.startRealtime();
  }

  startRealtime() {
    this.stopLiveRefresh();
    this.stopStream();

    if (typeof EventSource === "function") {
      try {
        this.startStream();
        return;
      } catch {
        // fallback polling
      }
    }

    this.startLiveRefresh();
  }

  startStream() {
    this.stream = window.httpClient.openPublicLobbiesStream(this.lastStreamRevision || null);

    this.stream.addEventListener("lobbies", (evt) => {
      if (!evt?.data) return;

      const payload = JSON.parse(evt.data);
      this.lastStreamRevision = Number(payload?.revision || evt.lastEventId || this.lastStreamRevision || 0);
      this.renderList(payload?.items ?? [], true);
      this.setStatus("Liste synchronisee en direct", true);
    });

    this.stream.onerror = () => {
      this.stopStream();
      this.startLiveRefresh();
      this.setStatus("Flux direct indisponible, bascule en rafraichissement auto", false);
    };
  }

  stopStream() {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
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
      if (!res.success) {
        this.setStatus(res.error || "Erreur chargement lobbies", false);
        return;
      }

      this.renderList(res.data?.items ?? [], silent);
      if (!silent) this.setStatus("Lobbies charges", true);
    } finally {
      this.isRefreshing = false;
    }
  }

  renderList(items, silent = false) {
    const list = document.getElementById("lobbylist-items");
    const count = document.getElementById("lobbylist-count");
    if (!list) return;

    if (count) {
      count.textContent = `${items.length} lobby${items.length > 1 ? "s" : ""} actif${items.length > 1 ? "s" : ""}`;
    }

    if (!items.length) {
      list.innerHTML = "<li>Aucun lobby public en cours.</li>";
      if (!silent) this.setStatus("Aucun lobby public disponible", true);
      return;
    }

    list.innerHTML = items
      .map((x) => `<li><button type="button" data-code="${x.lobby_code}" class="btn-join-public">${x.name} (${x.lobby_code}) - ${x.players_count}/${x.max_players}</button></li>`)
      .join("");

    list.querySelectorAll(".btn-join-public").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const code = btn.getAttribute("data-code") || "";
        await this.join(code);
      });
    });
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
    this.stopStream();
    this.stopLiveRefresh();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}
