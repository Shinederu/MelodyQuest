import { setCurrentLobby } from "../utils/LobbyState.js";

export class MainController {
  constructor() {
    this.user = JSON.parse(localStorage.getItem("user") || "null");
    this.stream = null;
    this.realtimeConfig = null;

    document.getElementById("btn-main-create")?.addEventListener("click", () => this.createLobby());
    document.getElementById("btn-main-join-code")?.addEventListener("click", () => this.joinLobbyByCode());
    document.getElementById("btn-main-management")?.addEventListener("click", () => window.appCtrl.changeView("management"));

    this.bootstrap();
  }

  async bootstrap() {
    this.renderAdminActions();
    await this.refreshLobbies();
    this.startRealtime();
  }

  async createLobby() {
    const lobbyName = this.normalizeLobbyName(
      document.getElementById("main-lobby-name")?.value,
      "Nouveau lobby"
    );

    const res = await window.httpClient.createLobby({
      name: lobbyName,
      visibility: "public",
      max_players: 8,
      round_duration_seconds: 30,
      total_rounds: 5,
      guess_mode: "title",
    });

    this.setStatus(res.success ? "Lobby cree" : (res.error || "Erreur"), res.success);

    if (res.success && res.data?.lobby) {
      setCurrentLobby(res.data.lobby);
      window.appCtrl.changeView("lobby");
    }
  }

  async joinLobbyByCode() {
    const input = document.getElementById("main-lobby-code");
    const code = String(input?.value || "").trim().toUpperCase();
    if (!code) {
      this.setStatus("Code de lobby requis", false);
      return;
    }

    const res = await window.httpClient.joinLobby(code);
    this.setStatus(res.success ? "Lobby rejoint" : (res.error || "Erreur"), res.success);

    if (res.success && res.data?.lobby) {
      setCurrentLobby(res.data.lobby);
      window.appCtrl.changeView("lobby");
    }
  }

  async refreshLobbies() {
    const res = await window.httpClient.listPublicLobbies();
    if (!res.success) {
      this.setStatus(res.error || "Impossible de charger les lobbies", false);
      return;
    }

    this.realtimeConfig = res.data?.realtime ?? null;
    this.renderLobbyList(res.data?.items ?? []);
  }

  startRealtime() {
    this.stopRealtime();
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
      this.stream.addEventListener(this.realtimeConfig.event || "message", (evt) => {
        if (!evt?.data) return;
        const payload = JSON.parse(evt.data);
        this.renderLobbyList(payload?.items ?? []);
      });
      this.stream.onerror = () => {
        this.stopRealtime();
        this.setStatus("Flux Mercure indisponible", false);
      };
      return true;
    } catch {
      return false;
    }
  }

  stopRealtime() {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
  }

  renderAdminActions() {
    const actions = document.getElementById("main-admin-actions");
    if (!actions) return;
    actions.style.display = this.user?.is_admin ? "" : "none";
  }

  renderLobbyList(items) {
    const list = document.getElementById("main-lobby-list");
    const empty = document.getElementById("main-lobby-empty");
    if (!list || !empty) return;

    if (!items.length) {
      list.innerHTML = "";
      empty.style.display = "";
      return;
    }

    empty.style.display = "none";
    list.innerHTML = items.map((lobby) => `
      <article class="mq-list-card">
        <div>
          <strong>${this.escapeHtml(lobby.name || "Lobby")}</strong>
          <p class="mq-muted">${this.escapeHtml(lobby.lobby_code || "")} · ${Number(lobby.players_count || 0)}/${Number(lobby.max_players || 0)} joueurs · ${this.escapeHtml(lobby.status || "waiting")}</p>
          <p class="mq-muted">Createur: ${this.escapeHtml(lobby.owner_username || "inconnu")}</p>
        </div>
        <button type="button" data-join-code="${this.escapeAttr(lobby.lobby_code || "")}">Rejoindre</button>
      </article>
    `).join("");

    list.querySelectorAll("[data-join-code]").forEach((button) => {
      button.addEventListener("click", () => this.joinFromButton(button.dataset.joinCode || ""));
    });
  }

  async joinFromButton(code) {
    if (!code) return;
    const res = await window.httpClient.joinLobby(code);
    this.setStatus(res.success ? "Lobby rejoint" : (res.error || "Erreur"), res.success);

    if (res.success && res.data?.lobby) {
      setCurrentLobby(res.data.lobby);
      window.appCtrl.changeView("lobby");
    }
  }

  setStatus(text, ok) {
    const status = document.getElementById("main-status");
    if (!status) return;
    status.textContent = text;
    status.className = ok ? "status success" : "status error";
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  escapeAttr(value) {
    return this.escapeHtml(value).replaceAll('"', "&quot;");
  }

  normalizeLobbyName(value, fallback = "Nouveau lobby") {
    const normalized = String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
    return normalized || fallback;
  }

  destroy() {
    this.stopRealtime();
  }
}
