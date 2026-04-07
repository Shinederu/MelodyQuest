import { getCurrentLobby, setCurrentLobby, clearCurrentLobby } from "../utils/LobbyState.js";

export class LobbyController {
  constructor() {
    this.currentLobby = getCurrentLobby();
    this.user = JSON.parse(localStorage.getItem("user") || "null");
    this.stream = null;
    this.lastStreamRevision = 0;
    this.categories = [];
    this.heartbeatInterval = null;
    this.isDestroyed = false;
    this.configDirty = false;
    this.configDraft = null;
    this.configSaveTimeout = null;
    this.configSaveInFlight = false;
    this.pendingConfigSave = false;

    this.visibilityHandler = () => {
      if (!document.hidden) {
        this.refreshNow();
      }
    };

    document.getElementById("btn-lobby-main")?.addEventListener("click", () => window.appCtrl.changeView("main"));
    document.getElementById("btn-lobby-leave")?.addEventListener("click", () => this.leaveLobby());
    document.getElementById("btn-lobby-delete")?.addEventListener("click", () => this.deleteLobby());
    document.getElementById("btn-lobby-start")?.addEventListener("click", () => this.startGame());

    document.addEventListener("visibilitychange", this.visibilityHandler);

    this.bootstrap();
  }

  getLobbyId() {
    return Number(this.currentLobby?.id || 0);
  }

  getLobbyCode() {
    return String(this.currentLobby?.lobby_code || "");
  }

  async bootstrap() {
    const code = this.getLobbyCode();
    if (!code) {
      this.setStatus("Aucun lobby selectionne", false);
      return;
    }

    const [categoriesRes, detail] = await Promise.all([
      window.httpClient.listCategories(),
      window.httpClient.getLobbyByCode(code),
    ]);

    if (categoriesRes.success) {
      this.categories = categoriesRes.data?.items ?? [];
    }

    if (!detail.success || !detail.data?.lobby) {
      this.setStatus(detail.error || "Lobby introuvable", false);
      return;
    }

    this.currentLobby = detail.data.lobby;
    setCurrentLobby(this.currentLobby);
    this.renderLobby(detail.data);
    await this.refreshRoundState(true);
    this.startRealtime();
    this.startHeartbeat();
  }

  startRealtime() {
    this.stopStream();

    if (typeof EventSource !== "function") return;

    try {
      this.stream = window.httpClient.openLobbyStream(this.getLobbyId(), this.lastStreamRevision || null);
      this.stream.addEventListener("lobby", (evt) => {
        if (!evt?.data) return;

        const payload = JSON.parse(evt.data);
        this.lastStreamRevision = Number(payload?.revision || evt.lastEventId || this.lastStreamRevision || 0);
        this.applyRealtimeSnapshot(payload);
        this.setStatus("Synchronise en direct", true);
      });

      this.stream.onerror = () => {
        this.stopStream();
        this.setStatus("Flux direct indisponible", false);
      };
    } catch {
      this.stopStream();
    }
  }

  stopStream() {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
  }

  async refreshNow() {
    const code = this.getLobbyCode();
    if (!code) return;

    const detail = await window.httpClient.getLobbyByCode(code);
    if (detail.success && detail.data?.lobby) {
      this.currentLobby = detail.data.lobby;
      setCurrentLobby(this.currentLobby);
      this.renderLobby(detail.data);
      await this.refreshRoundState(true);
      return;
    }

    this.exitLobbyIfActive();
  }

  applyRealtimeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;

    if (snapshot.lobby) {
      this.currentLobby = snapshot.lobby;
      setCurrentLobby(snapshot.lobby);
      this.renderLobby({ lobby: snapshot.lobby, players: snapshot.players || [] });
    }

    if (snapshot.round?.round) {
      const status = String(snapshot.round.round.status || "").toLowerCase();
      if (status === "running" || status === "reveal") {
        localStorage.removeItem("mq_last_scoreboard");
        window.appCtrl.changeView("game");
      }
    }
  }

  renderLobby(data) {
    const lobby = data?.lobby;
    const players = data?.players ?? [];
    const categoriesHost = document.getElementById("lobby-categories-selected");
    const playersHost = document.getElementById("lobby-players");
    const ownerOnly = document.querySelectorAll(".owner-only");
    const header = document.getElementById("lobby-title");
    const meta = document.getElementById("lobby-meta");
    const rounds = document.getElementById("lobby-rounds");
    const timer = document.getElementById("lobby-timer");

    if (header) header.textContent = lobby?.name || "Lobby";
    if (meta) meta.textContent = `Code ${lobby?.lobby_code || ""} · ${players.length}/${lobby?.max_players || 0} joueurs`;
    if (rounds) rounds.textContent = `${Number(lobby?.rounds_finished || 0)} / ${Number(lobby?.total_rounds || 0)} manches jouees`;
    if (timer) timer.textContent = `${Number(lobby?.round_duration_seconds || 0)} secondes par manche`;

    if (playersHost) {
      playersHost.innerHTML = players.map((player) => {
        const canKick = this.isOwner() && Number(player.user_id || 0) !== Number(this.user?.id || 0);
        return `
          <li class="mq-list-row">
            <div>
              <strong>${this.escapeHtml(player.username || "joueur")}</strong>
              <span class="mq-muted">${this.escapeHtml(player.role || "player")} · ${Number(player.score || 0)} pt</span>
            </div>
            ${canKick ? `<button type="button" class="mq-danger mq-inline-btn" data-kick-user="${Number(player.user_id || 0)}">Exclure</button>` : ""}
          </li>
        `;
      }).join("");

      playersHost.querySelectorAll("[data-kick-user]").forEach((button) => {
        button.addEventListener("click", () => this.kickPlayer(Number(button.dataset.kickUser || 0)));
      });
    }

    if (categoriesHost) {
      const selected = Array.isArray(lobby?.selected_category_ids) ? lobby.selected_category_ids.map(Number) : [];
      const names = this.categories
        .filter((category) => selected.includes(Number(category.id || 0)))
        .map((category) => category.name);
      categoriesHost.innerHTML = names.length
        ? names.map((name) => `<span class="mq-chip">${this.escapeHtml(name)}</span>`).join("")
        : `<span class="mq-muted">Toutes les categories actives</span>`;
    }

    const isOwner = Number(lobby?.owner_user_id || 0) === Number(this.user?.id || 0);
    ownerOnly.forEach((el) => {
      el.style.display = isOwner ? "" : "none";
    });

    this.renderOwnerForm(lobby);
  }

  renderOwnerForm(lobby) {
    const categoriesForm = document.getElementById("lobby-config-categories");
    const roundsInput = document.getElementById("lobby-config-rounds");
    const timerInput = document.getElementById("lobby-config-timer");
    const helper = document.getElementById("lobby-config-help");
    if (!categoriesForm) return;

    const editable = this.isOwner();
    const source = this.configDirty ? this.getDraftConfig(lobby) : this.getServerConfig(lobby);
    if (roundsInput) {
      roundsInput.value = String(Number(source.total_rounds || 5));
      roundsInput.disabled = !editable;
    }
    if (timerInput) {
      timerInput.value = String(Number(source.round_duration_seconds || 30));
      timerInput.disabled = !editable;
    }

    const selected = new Set((source.selected_category_ids || []).map((id) => Number(id)));
    categoriesForm.innerHTML = this.categories.map((category) => `
      <label class="mq-check">
        <input type="checkbox" value="${Number(category.id || 0)}" ${selected.has(Number(category.id || 0)) ? "checked" : ""} ${editable ? "" : "disabled"} />
        <span>${this.escapeHtml(category.name || "Categorie")}</span>
      </label>
    `).join("");

    if (helper) {
      helper.textContent = editable
        ? (this.configSaveInFlight ? "Configuration en cours d'application..." : "Les changements sont appliques automatiquement.")
        : "Configuration en lecture seule. Seul le createur peut la modifier.";
    }

    this.bindConfigInputs(lobby);
  }

  bindConfigInputs(lobby) {
    const roundsInput = document.getElementById("lobby-config-rounds");
    const timerInput = document.getElementById("lobby-config-timer");
    const categoryInputs = document.querySelectorAll("#lobby-config-categories input");
    const handleInput = () => this.handleConfigInput(lobby);
    const handleCategoryChange = () => this.handleConfigInput(lobby, true);

    if (roundsInput) roundsInput.oninput = handleInput;
    if (timerInput) timerInput.oninput = handleInput;
    categoryInputs.forEach((input) => {
      input.onchange = handleCategoryChange;
    });
  }

  handleConfigInput(lobby, immediate = false) {
    if (!this.isOwner()) return;
    this.captureDraftConfig(lobby);
    this.queueConfigSave(immediate ? 0 : 350);
  }

  queueConfigSave(delay = 350) {
    if (!this.isOwner()) return;
    if (this.configSaveTimeout) {
      clearTimeout(this.configSaveTimeout);
    }

    this.configSaveTimeout = window.setTimeout(() => {
      this.configSaveTimeout = null;
      this.saveConfig();
    }, delay);
  }

  getServerConfig(lobby) {
    return {
      total_rounds: Number(lobby?.total_rounds || 5),
      round_duration_seconds: Number(lobby?.round_duration_seconds || 30),
      selected_category_ids: (Array.isArray(lobby?.selected_category_ids) ? lobby.selected_category_ids : []).map(Number),
    };
  }

  getDraftConfig(lobby) {
    if (this.configDraft) return this.configDraft;
    return this.getServerConfig(lobby);
  }

  captureDraftConfig(lobby) {
    this.configDirty = true;
    this.configDraft = {
      total_rounds: Number(document.getElementById("lobby-config-rounds")?.value || lobby?.total_rounds || 5),
      round_duration_seconds: Number(document.getElementById("lobby-config-timer")?.value || lobby?.round_duration_seconds || 30),
      selected_category_ids: Array.from(document.querySelectorAll("#lobby-config-categories input:checked"))
        .map((input) => Number(input.value))
        .filter((value) => value > 0),
    };
  }

  async leaveLobby() {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;

    const res = await window.httpClient.leaveLobby(lobbyId);
    this.setStatus(res.success ? "Lobby quitte" : (res.error || "Erreur"), res.success);
    if (res.success) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
    }
  }

  async saveConfig() {
    if (!this.isOwner()) return;

    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;
    if (!this.configDirty && !this.configDraft) return;
    if (this.configSaveInFlight) {
      this.pendingConfigSave = true;
      return;
    }

    const draft = this.getDraftConfig(this.currentLobby);
    const draftKey = this.serializeConfig(draft);
    const serverKey = this.serializeConfig(this.getServerConfig(this.currentLobby));
    if (draftKey === serverKey) {
      this.configDirty = false;
      this.configDraft = null;
      return;
    }

    this.configSaveInFlight = true;
    this.pendingConfigSave = false;
    this.setStatus("Configuration en cours d'application...", true);

    const res = await window.httpClient.updateLobbyConfig({
      lobby_id: lobbyId,
      total_rounds: Number(draft.total_rounds || 5),
      round_duration_seconds: Number(draft.round_duration_seconds || 30),
      selected_category_ids: Array.isArray(draft.selected_category_ids) ? draft.selected_category_ids : [],
    });

    this.configSaveInFlight = false;

    if (res.success && res.data?.lobby) {
      if (this.serializeConfig(this.configDraft || this.getServerConfig(this.currentLobby)) === draftKey) {
        this.configDirty = false;
        this.configDraft = null;
      }
      this.currentLobby = res.data.lobby;
      setCurrentLobby(this.currentLobby);
      this.renderLobby(res.data);
      this.setStatus("Configuration synchronisee", true);
    } else {
      this.setStatus(res.error || "Erreur", false);
    }

    if (this.pendingConfigSave) {
      this.pendingConfigSave = false;
      this.queueConfigSave(150);
    }
  }

  async startGame() {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;

    const res = await window.httpClient.startRound(lobbyId);
    this.setStatus(res.success ? "Partie demarree" : (res.error || "Erreur"), res.success);
    if (res.success) {
      localStorage.removeItem("mq_last_scoreboard");
      window.appCtrl.changeView("game");
    }
  }

  async deleteLobby() {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;

    const res = await window.httpClient.deleteLobby(lobbyId);
    this.setStatus(res.success ? "Lobby supprime" : (res.error || "Erreur"), res.success);
    if (res.success) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
    }
  }

  async kickPlayer(targetUserId) {
    const lobbyId = this.getLobbyId();
    if (!lobbyId || targetUserId <= 0) return;

    const res = await window.httpClient.kickPlayer(lobbyId, targetUserId);
    this.setStatus(res.success ? "Utilisateur exclu" : (res.error || "Erreur"), res.success);
    if (res.success && res.data?.lobby) {
      this.currentLobby = res.data.lobby;
      setCurrentLobby(this.currentLobby);
      this.renderLobby(res.data);
    }
  }

  async refreshRoundState(silent = false) {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;
    const res = await window.httpClient.getRoundState(lobbyId);
    if (!silent || !res.success) {
      this.setStatus(res.success ? "Lobby charge" : (res.error || "Erreur"), res.success);
    }
    if (res.success && res.data?.round) {
      const status = String(res.data.round.status || "").toLowerCase();
      if (status === "running" || status === "reveal") {
        localStorage.removeItem("mq_last_scoreboard");
        window.appCtrl.changeView("game");
      }
      return;
    }

    if (!res.success && /lobby introuvable/i.test(String(res.error || ""))) {
      this.exitLobbyIfActive();
    }
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
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;

    const res = await window.httpClient.touchLobby(lobbyId);
    if (res.success) return;

    if (/lobby introuvable/i.test(String(res.error || "")) || /utilisateur non present/i.test(String(res.error || ""))) {
      this.exitLobbyIfActive();
    }
  }

  exitLobbyIfActive() {
    if (this.isDestroyed) return;
    clearCurrentLobby();
    window.appCtrl.changeView("main");
  }

  isOwner() {
    return Number(this.currentLobby?.owner_user_id || 0) === Number(this.user?.id || 0);
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  setStatus(text, ok) {
    const el = document.getElementById("lobby-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }

  serializeConfig(config) {
    if (!config || typeof config !== "object") return "";
    return JSON.stringify({
      total_rounds: Number(config.total_rounds || 5),
      round_duration_seconds: Number(config.round_duration_seconds || 30),
      selected_category_ids: Array.isArray(config.selected_category_ids) ? config.selected_category_ids.map(Number) : [],
    });
  }

  destroy() {
    this.isDestroyed = true;
    this.stopStream();
    this.stopHeartbeat();
    if (this.configSaveTimeout) {
      clearTimeout(this.configSaveTimeout);
      this.configSaveTimeout = null;
    }
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}
