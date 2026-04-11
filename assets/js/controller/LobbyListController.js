import { setCurrentLobby } from "../utils/LobbyState.js";

export class LobbyListController {
  constructor() {
    this.isRefreshing = false;
    this.stream = null;
    this.realtimeConfig = null;
    this.isDestroyed = false;
    this.realtimeConnected = false;
    this.hasRealtimeOpened = false;
    this.lastRealtimeRevision = "";

    this.visibilityHandler = () => {
      if (!document.hidden) {
        this.refresh(true);
      }
    };

    document.getElementById("btn-lobbylist-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-lobbylist-join")?.addEventListener("click", () => this.joinByCode());
    document.getElementById("btn-lobbylist-back")?.addEventListener("click", () => window.appCtrl.changeView("main"));
    document.addEventListener("visibilitychange", this.visibilityHandler);

    this.bootstrap();
  }

  async bootstrap() {
    await this.refresh();
    this.startRealtime();
  }

  startRealtime() {
    this.stopStream();
    if (!this.startMercureRealtime()) {
      this.setStatus("Temps reel Mercure indisponible", false);
    }
  }

  startMercureRealtime() {
    if (this.realtimeConfig?.transport !== "mercure") {
      return false;
    }

    try {
      this.stream = window.httpClient.openMercureSubscription(this.realtimeConfig);
      this.stream.addEventListener("open", () => this.handleMercureOpen());
      this.stream.addEventListener(this.realtimeConfig.event || "message", (evt) => {
        if (!evt?.data) return;

        let payload;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (!this.shouldApplyRealtimePayload(payload)) {
          return;
        }
        this.renderList(payload?.items ?? [], true);
      });

      this.stream.onerror = () => this.handleMercureError();

      return true;
    } catch {
      return false;
    }
  }

  handleMercureOpen() {
    if (this.isDestroyed) return;

    const reopened = this.hasRealtimeOpened;
    this.hasRealtimeOpened = true;
    this.realtimeConnected = true;
    this.setStatus("Liste synchronisee via Mercure", true);

    if (reopened) {
      this.refresh(true);
    }
  }

  handleMercureError() {
    if (this.isDestroyed || !this.stream) return;

    const wasConnected = this.realtimeConnected;
    this.realtimeConnected = false;
    this.setStatus(
      wasConnected
        ? "Connexion Mercure interrompue, tentative de reconnexion..."
        : "Connexion Mercure en attente...",
      false
    );
  }

  shouldApplyRealtimePayload(payload) {
    const revision = String(payload?.revision ?? "");
    if (!revision) {
      return true;
    }

    if (revision === this.lastRealtimeRevision) {
      return false;
    }

    this.lastRealtimeRevision = revision;
    return true;
  }

  stopStream() {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
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

      this.realtimeConfig = res.data?.realtime ?? null;
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
    if (!joinRes.success || !joinRes.data?.lobby) {
      this.setStatus(joinRes.error || "Echec join", false);
      return;
    }

    setCurrentLobby(joinRes.data.lobby);
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
    this.isDestroyed = true;
    this.stopStream();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}
