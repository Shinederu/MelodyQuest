import { setCurrentLobby } from "../utils/LobbyState.js";
import { escapeAttribute, escapeHtml } from "../utils/ui.js?v=20260610-shared-utils";

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

    if (reopened) {
      this.refresh(true);
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
        this.setStatus(res.error || "Impossible de charger les salons", false);
        return;
      }

      this.realtimeConfig = res.data?.realtime ?? null;
      this.renderList(res.data?.items ?? [], silent);
    } finally {
      this.isRefreshing = false;
    }
  }

  renderList(items, silent = false) {
    const list = document.getElementById("lobbylist-items");
    const count = document.getElementById("lobbylist-count");
    if (!list) return;

    if (count) {
      count.textContent = `${items.length} salon${items.length > 1 ? "s" : ""} actif${items.length > 1 ? "s" : ""}`;
    }

    if (!items.length) {
      list.innerHTML = `
        <li class="mq-list-row">
          <div>
            <strong>Aucun salon public</strong>
            <span class="mq-muted">Crée ton salon depuis l'accueil ou utilise un code privé.</span>
          </div>
        </li>
      `;
      if (!silent) this.setStatus("Aucun salon public disponible", true);
      return;
    }

    list.innerHTML = items.map((lobby) => `
      <li class="mq-list-row">
        <div>
          <strong>${this.escapeHtml(lobby.name || "Salon")}</strong>
          <span class="mq-muted">${Number(lobby.players_count || 0)}/${Number(lobby.max_players || 0)} joueurs - Code ${this.escapeHtml(lobby.lobby_code || "")}</span>
        </div>
        <button type="button" data-code="${this.escapeAttr(lobby.lobby_code || "")}">Entrer</button>
      </li>
    `).join("");

    list.querySelectorAll("[data-code]").forEach((btn) => {
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
      this.setStatus(joinRes.error || "Impossible de rejoindre ce salon", false);
      return;
    }

    setCurrentLobby(joinRes.data.lobby);
    this.setStatus("Salon rejoint", true);
    window.appCtrl.changeView("lobby");
  }

  setStatus(text, ok) {
    const status = document.getElementById("lobbylist-status");
    if (!status) return;
    status.textContent = text;
    status.className = ok ? "status success" : "status error";
  }

  escapeHtml(value) {
    return escapeHtml(value);
  }

  escapeAttr(value) {
    return escapeAttribute(value);
  }

  destroy() {
    this.isDestroyed = true;
    this.stopStream();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}
