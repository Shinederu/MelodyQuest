import { setCurrentLobby } from "../utils/LobbyState.js";

export class MainController {
  constructor() {
    this.user = JSON.parse(localStorage.getItem("user") || "null");
    this.stream = null;
    this.realtimeConfig = null;
    this.isDestroyed = false;
    this.realtimeConnected = false;
    this.hasRealtimeOpened = false;
    this.lastRealtimeRevision = "";

    this.visibilityHandler = () => {
      if (!document.hidden) {
        this.refreshLobbies(true);
      }
    };

    document.getElementById("btn-main-create")?.addEventListener("click", () => this.createLobby());
    document.getElementById("btn-main-join-code")?.addEventListener("click", () => this.joinLobbyByCode());
    document.getElementById("btn-main-refresh")?.addEventListener("click", () => this.refreshLobbies());
    document.getElementById("btn-main-management")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.addEventListener("visibilitychange", this.visibilityHandler);

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
      "Nouveau salon"
    );

    const res = await window.httpClient.createLobby({
      name: lobbyName,
      visibility: "public",
      max_players: 8,
      round_duration_seconds: 30,
      total_rounds: 5,
      guess_mode: "title",
    });

    this.setStatus(res.success ? "Salon cree" : (res.error || "Erreur"), res.success);

    if (res.success && res.data?.lobby) {
      setCurrentLobby(res.data.lobby);
      window.appCtrl.changeView("lobby");
    }
  }

  async joinLobbyByCode() {
    const input = document.getElementById("main-lobby-code");
    const code = String(input?.value || "").trim().toUpperCase();
    if (!code) {
      this.setStatus("Code de salon requis", false);
      return;
    }

    const res = await window.httpClient.joinLobby(code);
    this.setStatus(res.success ? "Salon rejoint" : (res.error || "Erreur"), res.success);

    if (res.success && res.data?.lobby) {
      setCurrentLobby(res.data.lobby);
      window.appCtrl.changeView("lobby");
    }
  }

  async refreshLobbies(silent = false) {
    const res = await window.httpClient.listPublicLobbies();
    if (!res.success) {
      if (!silent) {
        this.setStatus(res.error || "Impossible de charger les salons", false);
      }
      return;
    }

    this.realtimeConfig = res.data?.realtime ?? null;
    this.renderLobbyList(res.data?.items ?? []);
  }

  startRealtime() {
    this.stopRealtime();
    this.startMercureRealtime();
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
        this.renderLobbyList(payload?.items ?? []);
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

    if (reopened) {
      this.refreshLobbies(true);
    }
  }

  handleMercureError() {
    if (this.isDestroyed || !this.stream) return;

    this.realtimeConnected = false;
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
    const count = document.getElementById("main-lobby-count");
    if (!list) return;

    if (count) {
      count.textContent = `${items.length} salon${items.length > 1 ? "s" : ""} actif${items.length > 1 ? "s" : ""}`;
    }

    if (!items.length) {
      list.innerHTML = `
        <li class="mq-list-row">
          <div>
            <strong>Aucun salon public</strong>
            <span class="mq-muted">Cree ton salon depuis le depart rapide ou utilise un code prive.</span>
          </div>
        </li>
      `;
      return;
    }

    list.innerHTML = items.map((lobby) => `
      <li class="mq-list-row">
        <div>
          <strong>${this.escapeHtml(lobby.name || "Salon")}</strong>
          <span class="mq-muted">${Number(lobby.players_count || 0)}/${Number(lobby.max_players || 0)} joueurs - Code ${this.escapeHtml(lobby.lobby_code || "")}</span>
          ${lobby.owner_username ? `<span class="mq-muted">Cree par ${this.escapeHtml(lobby.owner_username)}</span>` : ""}
        </div>
        <button type="button" data-join-code="${this.escapeAttr(lobby.lobby_code || "")}">Entrer</button>
      </li>
    `).join("");

    list.querySelectorAll("[data-join-code]").forEach((button) => {
      button.addEventListener("click", () => this.joinFromButton(button.dataset.joinCode || ""));
    });
  }

  async joinFromButton(code) {
    if (!code) return;
    const res = await window.httpClient.joinLobby(code);
    this.setStatus(res.success ? "Salon rejoint" : (res.error || "Erreur"), res.success);

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

  normalizeLobbyName(value, fallback = "Nouveau salon") {
    const normalized = String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
    return normalized || fallback;
  }

  destroy() {
    this.isDestroyed = true;
    this.stopRealtime();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}
