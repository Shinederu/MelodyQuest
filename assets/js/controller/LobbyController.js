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

    this.visibilityHandler = () => {
      if (!document.hidden) {
        this.refreshNow();
      }
    };

    document.getElementById("btn-lobby-main")?.addEventListener("click", () => window.appCtrl.changeView("main"));
    document.getElementById("btn-lobby-leave")?.addEventListener("click", () => this.leaveLobby());
    document.getElementById("btn-lobby-save-config")?.addEventListener("click", () => this.saveConfig());
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
    if (roundsInput) roundsInput.value = String(Number(lobby?.total_rounds || 5));
    if (timerInput) timerInput.value = String(Number(lobby?.round_duration_seconds || 30));
    if (!categoriesForm) return;

    const selected = new Set((Array.isArray(lobby?.selected_category_ids) ? lobby.selected_category_ids : []).map((id) => Number(id)));
    categoriesForm.innerHTML = this.categories.map((category) => `
      <label class="mq-check">
        <input type="checkbox" value="${Number(category.id || 0)}" ${selected.has(Number(category.id || 0)) ? "checked" : ""} />
        <span>${this.escapeHtml(category.name || "Categorie")}</span>
      </label>
    `).join("");
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
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;

    const rounds = Number(document.getElementById("lobby-config-rounds")?.value || 5);
    const timer = Number(document.getElementById("lobby-config-timer")?.value || 30);
    const selectedCategoryIds = Array.from(document.querySelectorAll("#lobby-config-categories input:checked"))
      .map((input) => Number(input.value))
      .filter((value) => value > 0);

    const res = await window.httpClient.updateLobbyConfig({
      lobby_id: lobbyId,
      total_rounds: rounds,
      round_duration_seconds: timer,
      selected_category_ids: selectedCategoryIds,
      guess_mode: "title",
    });

    this.setStatus(res.success ? "Configuration enregistree" : (res.error || "Erreur"), res.success);

    if (res.success && res.data?.lobby) {
      this.currentLobby = res.data.lobby;
      setCurrentLobby(this.currentLobby);
      this.renderLobby(res.data);
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

  destroy() {
    this.isDestroyed = true;
    this.stopStream();
    this.stopHeartbeat();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}
