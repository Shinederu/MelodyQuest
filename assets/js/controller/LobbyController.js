import { getCurrentLobby, setCurrentLobby, clearCurrentLobby } from "../utils/LobbyState.js";

const MIN_TOTAL_ROUNDS = 1;
const MAX_TOTAL_ROUNDS = 1000;
const MIN_ROUND_DURATION = 1;
const MAX_ROUND_DURATION = 600;

export class LobbyController {
  constructor() {
    this.currentLobby = getCurrentLobby();
    this.user = JSON.parse(localStorage.getItem("user") || "null");
    this.stream = null;
    this.realtimeConfig = null;
    this.categories = [];
    this.heartbeatInterval = null;
    this.isDestroyed = false;
    this.realtimeConnected = false;
    this.hasRealtimeOpened = false;
    this.lastRealtimeRevision = "";
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
      this.setStatus("Aucun lobby sélectionné", false);
      return;
    }

    this.startHeartbeat();

    let categoriesRes;
    let detail;
    try {
      [categoriesRes, detail] = await Promise.all([
        window.httpClient.listCategories(),
        window.httpClient.getLobbyByCode(code),
      ]);
    } catch {
      this.setStatus("Impossible de charger le salon. Réessaie dans quelques secondes.", false);
      return;
    }

    this.categories = categoriesRes?.success ? (categoriesRes.data?.items ?? []) : [];

    if (!detail.success || !detail.data?.lobby) {
      this.setStatus(detail.error || "Lobby introuvable", false);
      if (this.shouldExitLobby(detail.error)) {
        this.stopHeartbeat();
      }
      return;
    }

    if (!categoriesRes?.success) {
      this.setStatus(categoriesRes?.error || "Impossible de charger les catégories", false);
    }

    this.currentLobby = detail.data.lobby;
    this.realtimeConfig = detail.data?.realtime ?? null;
    setCurrentLobby(this.currentLobby);
    this.renderLobby(detail.data);
    await this.refreshRoundState(true);
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
        this.applyRealtimeSnapshot(payload);
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
      this.refreshNow();
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

  async refreshNow() {
    const code = this.getLobbyCode();
    if (!code) return;

    let detail;
    try {
      detail = await window.httpClient.getLobbyByCode(code);
    } catch {
      this.setStatus("Connexion au salon interrompue temporairement.", false);
      return;
    }

    if (detail.success && detail.data?.lobby) {
      this.currentLobby = detail.data.lobby;
      this.realtimeConfig = detail.data?.realtime ?? this.realtimeConfig;
      setCurrentLobby(this.currentLobby);
      this.renderLobby(detail.data);
      await this.refreshRoundState(true);
      return;
    }

    if (this.shouldExitLobby(detail.error)) {
      this.exitLobbyIfActive();
      return;
    }

    this.setStatus(detail.error || "Impossible de rafraîchir le salon", false);
  }

  applyRealtimeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    if (snapshot.deleted) {
      this.exitLobbyIfActive();
      return;
    }

    if (Array.isArray(snapshot.players)) {
      const currentUserId = Number(this.user?.id || 0);
      const stillPresent = snapshot.players.some((player) => Number(player.user_id || 0) === currentUserId);
      if (!stillPresent) {
        this.exitLobbyIfActive();
        return;
      }
    }

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
    const playersHost = document.getElementById("lobby-players");
    const ownerOnly = document.querySelectorAll(".owner-only");
    const header = document.getElementById("lobby-title");
    const meta = document.getElementById("lobby-meta");
    const rounds = document.getElementById("lobby-rounds");
    const timer = document.getElementById("lobby-timer");
    const displayConfig = this.configDirty ? this.getDraftConfig(lobby) : this.getServerConfig(lobby);

    if (header) header.textContent = displayConfig.name || lobby?.name || "Salon";
    if (meta) {
      const visibilityLabel = displayConfig.visibility === "private" ? "privé" : "public";
      meta.textContent = `Code ${lobby?.lobby_code || ""} - ${players.length}/${lobby?.max_players || 0} joueurs - Salon ${visibilityLabel}`;
    }
    if (rounds) rounds.textContent = `${Number(lobby?.rounds_finished || 0)} / ${Number(lobby?.total_rounds || 0)} manches`;
    if (timer) timer.textContent = `${Number(lobby?.round_duration_seconds || 0)}s par réponse`;

    if (playersHost) {
      playersHost.innerHTML = players.map((player) => {
        const canKick = this.isOwner() && Number(player.user_id || 0) !== Number(this.user?.id || 0);
        return `
          <li class="mq-list-row">
            <div class="mq-player-line">
              ${this.renderAvatar(player)}
              <div>
                <strong>${this.escapeHtml(player.username || "joueur")}</strong>
                <span class="mq-muted">${this.escapeHtml(this.formatPlayerRole(player.role))} - ${Number(player.score || 0)} pt</span>
              </div>
            </div>
            ${canKick ? `<button type="button" class="mq-danger mq-inline-btn" data-kick-user="${Number(player.user_id || 0)}">Exclure</button>` : ""}
          </li>
        `;
      }).join("");

      playersHost.querySelectorAll("[data-kick-user]").forEach((button) => {
        button.addEventListener("click", () => this.kickPlayer(Number(button.dataset.kickUser || 0)));
      });
    }

    const isOwner = Number(lobby?.owner_user_id || 0) === Number(this.user?.id || 0);
    ownerOnly.forEach((el) => {
      el.style.display = isOwner ? "" : "none";
    });

    this.renderOwnerForm(lobby);
  }

  renderOwnerForm(lobby) {
    const nameInput = document.getElementById("lobby-config-name");
    const categoriesForm = document.getElementById("lobby-config-categories");
    const roundsInput = document.getElementById("lobby-config-rounds");
    const timerInput = document.getElementById("lobby-config-timer");
    const publicInput = document.getElementById("lobby-config-public");
    const showCategoryInput = document.getElementById("lobby-config-show-category");
    const earlyRevealInput = document.getElementById("lobby-config-early-reveal");
    if (!categoriesForm) return;

    const editable = this.isOwner();
    const source = this.configDirty ? this.getDraftConfig(lobby) : this.getServerConfig(lobby);
    if (nameInput) {
      nameInput.value = String(source.name || "");
      nameInput.disabled = !editable;
    }
    if (roundsInput) {
      roundsInput.value = Number.isFinite(source.total_rounds) ? String(source.total_rounds) : "";
      roundsInput.disabled = !editable;
    }
    if (timerInput) {
      timerInput.value = Number.isFinite(source.round_duration_seconds) ? String(source.round_duration_seconds) : "";
      timerInput.disabled = !editable;
    }
    if (publicInput) {
      publicInput.checked = source.visibility !== "private";
      publicInput.disabled = !editable;
    }
    if (showCategoryInput) {
      showCategoryInput.checked = Boolean(source.show_track_category);
      showCategoryInput.disabled = !editable;
    }
    if (earlyRevealInput) {
      earlyRevealInput.checked = Boolean(source.allow_early_reveal_vote);
      earlyRevealInput.disabled = !editable;
    }

    const selected = new Set((source.selected_category_ids || []).map((id) => Number(id)));
    categoriesForm.innerHTML = this.categories.map((category) => `
      <label class="mq-check">
        <input type="checkbox" value="${Number(category.id || 0)}" ${selected.has(Number(category.id || 0)) ? "checked" : ""} ${editable ? "" : "disabled"} />
        <span>${this.escapeHtml(category.name || "Catégorie")} (${this.getCategoryTrackCount(category)})</span>
      </label>
    `).join("");

    this.bindConfigInputs(lobby);
    this.updateConfigUiState(source, editable);
  }

  bindConfigInputs(lobby) {
    const nameInput = document.getElementById("lobby-config-name");
    const roundsInput = document.getElementById("lobby-config-rounds");
    const timerInput = document.getElementById("lobby-config-timer");
    const publicInput = document.getElementById("lobby-config-public");
    const showCategoryInput = document.getElementById("lobby-config-show-category");
    const earlyRevealInput = document.getElementById("lobby-config-early-reveal");
    const categoryInputs = document.querySelectorAll("#lobby-config-categories input");
    const handleInput = () => this.handleConfigInput(lobby);
    const handleCategoryChange = () => this.handleConfigInput(lobby, true);

    if (nameInput) nameInput.oninput = handleInput;
    if (roundsInput) roundsInput.oninput = handleInput;
    if (timerInput) timerInput.oninput = handleInput;
    if (publicInput) publicInput.onchange = handleCategoryChange;
    if (showCategoryInput) showCategoryInput.onchange = handleCategoryChange;
    if (earlyRevealInput) earlyRevealInput.onchange = handleCategoryChange;
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
      name: this.normalizeLobbyName(lobby?.name, "Nouveau salon"),
      visibility: String(lobby?.visibility || "private").toLowerCase() === "private" ? "private" : "public",
      total_rounds: Number.parseInt(lobby?.total_rounds ?? 5, 10),
      round_duration_seconds: Number.parseInt(lobby?.round_duration_seconds ?? 30, 10),
      show_track_category: this.toBool(lobby?.show_track_category),
      allow_early_reveal_vote: this.toBool(lobby?.allow_early_reveal_vote ?? true),
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
      name: this.normalizeLobbyName(
        document.getElementById("lobby-config-name")?.value,
        this.getServerConfig(lobby).name
      ),
      visibility: document.getElementById("lobby-config-public")?.checked ? "public" : "private",
      total_rounds: this.parseIntegerInput(document.getElementById("lobby-config-rounds")?.value),
      round_duration_seconds: this.parseIntegerInput(document.getElementById("lobby-config-timer")?.value),
      show_track_category: document.getElementById("lobby-config-show-category")?.checked === true,
      allow_early_reveal_vote: document.getElementById("lobby-config-early-reveal")?.checked === true,
      selected_category_ids: Array.from(document.querySelectorAll("#lobby-config-categories input:checked"))
        .map((input) => Number(input.value))
        .filter((value) => value > 0),
    };

    const header = document.getElementById("lobby-title");
    if (header) {
      header.textContent = this.configDraft.name;
    }

    this.updateConfigUiState(this.configDraft, this.isOwner());
  }

  async leaveLobby() {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;

    const res = await window.httpClient.leaveLobby(lobbyId);
    this.setStatus(res.success ? "Salon quitté" : (res.error || "Erreur"), res.success);
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
    const validation = this.validateConfig(draft);
    if (validation.issues.length) {
      this.updateConfigUiState(draft, true, validation);
      return;
    }

    const draftKey = this.serializeConfig(draft);
    const serverKey = this.serializeConfig(this.getServerConfig(this.currentLobby));
    if (draftKey === serverKey) {
      this.configDirty = false;
      this.configDraft = null;
      this.updateConfigUiState(this.getServerConfig(this.currentLobby), true);
      return;
    }

    this.configSaveInFlight = true;
    this.pendingConfigSave = false;
    this.setStatus("Réglages en cours d'application...", true);

    const res = await window.httpClient.updateLobbyConfig({
      lobby_id: lobbyId,
      name: draft.name,
      visibility: draft.visibility === "private" ? "private" : "public",
      total_rounds: Number(draft.total_rounds || 5),
      round_duration_seconds: Number(draft.round_duration_seconds || 30),
      show_track_category: Boolean(draft.show_track_category),
      allow_early_reveal_vote: Boolean(draft.allow_early_reveal_vote),
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
      this.setStatus("Réglages sauvegardés", true);
    } else {
      this.updateConfigUiState(draft, true, validation);
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

    this.captureDraftConfig(this.currentLobby);
    const draft = this.getDraftConfig(this.currentLobby);
    const validation = this.validateConfig(draft);
    if (validation.issues.length) {
      this.updateConfigUiState(draft, true, validation);
      this.setStatus(validation.issues[0], false);
      return;
    }

    if (this.configSaveTimeout) {
      clearTimeout(this.configSaveTimeout);
      this.configSaveTimeout = null;
    }
    if (this.configDirty || this.configSaveInFlight) {
      await this.saveConfig();
      if (this.configSaveInFlight || this.configDirty) {
        return;
      }
    }

    const res = await window.httpClient.startRound(lobbyId);
    this.setStatus(res.success ? "Partie lancée" : (res.error || "Erreur"), res.success);
    if (res.success) {
      localStorage.removeItem("mq_last_scoreboard");
      window.appCtrl.changeView("game");
    }
  }

  async deleteLobby() {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;

    const res = await window.httpClient.deleteLobby(lobbyId);
    this.setStatus(res.success ? "Salon supprimé" : (res.error || "Erreur"), res.success);
    if (res.success) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
    }
  }

  async kickPlayer(targetUserId) {
    const lobbyId = this.getLobbyId();
    if (!lobbyId || targetUserId <= 0) return;

    const res = await window.httpClient.kickPlayer(lobbyId, targetUserId);
    this.setStatus(res.success ? "Joueur retiré du salon" : (res.error || "Erreur"), res.success);
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
      this.setStatus(res.success ? "Salon prêt" : (res.error || "Erreur"), res.success);
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

    if (/lobby introuvable/i.test(String(res.error || "")) || /utilisateur non pr[eé]sent/i.test(String(res.error || ""))) {
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

  renderAvatar(player) {
    const username = String(player?.username || "joueur");
    const avatarUrl = String(player?.avatar_url || "").trim();
    if (avatarUrl) {
      return `<img class="mq-avatar" src="${this.escapeAttr(avatarUrl)}" alt="" loading="lazy" />`;
    }

    return `<span class="mq-avatar mq-avatar--fallback" aria-hidden="true">${this.escapeHtml(this.getInitials(username))}</span>`;
  }

  getInitials(username) {
    const parts = String(username || "joueur").trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1
      ? `${parts[0][0] || ""}${parts[1][0] || ""}`
      : String(parts[0] || "j").slice(0, 2);

    return letters.toUpperCase();
  }

  formatPlayerRole(role) {
    return String(role || "").toLowerCase() === "owner" ? "créateur" : "joueur";
  }

  toBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
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

  setStatus(text, ok) {
    const el = document.getElementById("lobby-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }

  serializeConfig(config) {
    if (!config || typeof config !== "object") return "";
    return JSON.stringify({
      name: this.normalizeLobbyName(config.name, "Nouveau salon"),
      visibility: config.visibility === "private" ? "private" : "public",
      total_rounds: Number.parseInt(config.total_rounds ?? 0, 10),
      round_duration_seconds: Number.parseInt(config.round_duration_seconds ?? 0, 10),
      show_track_category: Boolean(config.show_track_category),
      allow_early_reveal_vote: Boolean(config.allow_early_reveal_vote),
      selected_category_ids: Array.isArray(config.selected_category_ids) ? config.selected_category_ids.map(Number) : [],
    });
  }

  normalizeLobbyName(value, fallback = "Nouveau salon") {
    const normalized = String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
    return normalized || fallback;
  }

  parseIntegerInput(value) {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  getCategoryTrackCount(category) {
    return Math.max(0, Number(category?.track_count || 0));
  }

  getAvailableTrackCount(selectedCategoryIds = []) {
    const selected = new Set((Array.isArray(selectedCategoryIds) ? selectedCategoryIds : []).map(Number));
    return this.categories.reduce((total, category) => {
      if (!selected.has(Number(category?.id || 0))) {
        return total;
      }
      return total + this.getCategoryTrackCount(category);
    }, 0);
  }

  validateConfig(config) {
    const totalRounds = Number.parseInt(config?.total_rounds ?? 0, 10);
    const roundDuration = Number.parseInt(config?.round_duration_seconds ?? 0, 10);
    const selectedCategoryIds = Array.isArray(config?.selected_category_ids) ? config.selected_category_ids.map(Number) : [];
    const availableTracks = this.getAvailableTrackCount(selectedCategoryIds);
    const issues = [];

    if (selectedCategoryIds.length === 0) {
      issues.push("Sélectionne au moins une catégorie.");
    }
    if (!Number.isInteger(totalRounds) || totalRounds < MIN_TOTAL_ROUNDS || totalRounds > MAX_TOTAL_ROUNDS) {
      issues.push(`Le nombre de manches doit etre compris entre ${MIN_TOTAL_ROUNDS} et ${MAX_TOTAL_ROUNDS}.`);
    }
    if (!Number.isInteger(roundDuration) || roundDuration < MIN_ROUND_DURATION || roundDuration > MAX_ROUND_DURATION) {
      issues.push(`Le chrono doit etre compris entre ${MIN_ROUND_DURATION} et ${MAX_ROUND_DURATION} secondes.`);
    }
    if (selectedCategoryIds.length > 0 && availableTracks < Math.max(0, totalRounds || 0)) {
      issues.push(`Pas assez de musiques disponibles: ${availableTracks} pour ${Number.isInteger(totalRounds) ? totalRounds : 0} manches.`);
    }

    return {
      issues,
      selectedCount: selectedCategoryIds.length,
      availableTracks,
      totalRounds,
      roundDuration,
    };
  }

  updateConfigUiState(config, editable, validation = null) {
    const helper = document.getElementById("lobby-config-help");
    const startButton = document.getElementById("btn-lobby-start");
    const review = validation || this.validateConfig(config);

    if (helper) {
      if (!editable) {
        helper.textContent = `${review.selectedCount} catégorie(s) sélectionnée(s) - ${review.availableTracks} musique(s) disponible(s).`;
        helper.className = "mq-muted";
      } else if (review.issues.length) {
        helper.textContent = review.issues[0];
        helper.className = "status error";
      } else if (this.configSaveInFlight) {
        helper.textContent = "Réglages en cours d'application...";
        helper.className = "status";
      } else if (this.configDirty) {
        helper.textContent = `${review.selectedCount} catégorie(s) sélectionnée(s) - ${review.availableTracks} musique(s) disponibles.`;
        helper.className = "status success";
      } else {
        helper.textContent = `Réglages sauvegardés - ${review.selectedCount} catégorie(s) - ${review.availableTracks} musique(s) disponibles.`;
        helper.className = "mq-muted";
      }
    }

    if (startButton) {
      startButton.disabled = !editable || this.configSaveInFlight || review.issues.length > 0;
    }
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
