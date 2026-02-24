import { getCurrentLobby, clearCurrentLobby } from "../utils/LobbyState.js";

export class LobbyController {
  constructor() {
    this.currentLobby = getCurrentLobby();
    this.user = JSON.parse(localStorage.getItem("user") || "null");
    this.liveInterval = null;
    this.isLiveRefreshing = false;
    this.stream = null;
    this.lastStreamRevision = 0;

    this.visibilityHandler = () => {
      if (!document.hidden) {
        this.refreshNow();
      }
    };

    document.getElementById("btn-lobby-back")?.addEventListener("click", () => window.appCtrl.changeView("lobby-list"));
    document.getElementById("btn-lobby-main")?.addEventListener("click", () => window.appCtrl.changeView("main"));
    document.getElementById("btn-lobby-leave")?.addEventListener("click", () => this.leaveLobby());

    document.getElementById("btn-pool-add")?.addEventListener("click", () => this.addTrackToPool());
    document.getElementById("btn-pool-remove")?.addEventListener("click", () => this.removeTrackFromPool());
    document.getElementById("btn-pool-refresh")?.addEventListener("click", () => this.refreshPool());

    document.getElementById("btn-round-start")?.addEventListener("click", () => this.startRound());
    document.getElementById("btn-round-reveal")?.addEventListener("click", () => this.revealRound());
    document.getElementById("btn-round-finish")?.addEventListener("click", () => this.finishRound());
    document.getElementById("btn-round-refresh")?.addEventListener("click", () => this.refreshRoundState());

    document.getElementById("btn-submit-answer")?.addEventListener("click", () => this.submitAnswer());
    document.getElementById("btn-refresh-playback")?.addEventListener("click", () => this.refreshPlayback());
    document.getElementById("btn-refresh-scoreboard")?.addEventListener("click", () => this.refreshScoreboard());

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
      this.setStatus("lobby-status", "Aucun lobby selectionne", false);
      return;
    }

    const detail = await window.httpClient.getLobbyByCode(code);
    if (!detail.success || !detail.data?.lobby) {
      this.setStatus("lobby-status", detail.error || "Lobby introuvable", false);
      return;
    }

    this.currentLobby = detail.data.lobby;
    this.renderLobbyInfo(detail.data);
    await Promise.all([this.refreshPool(), this.refreshRoundState(), this.refreshPlayback(), this.refreshScoreboard()]);
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
    const lobbyId = this.getLobbyId();
    if (!lobbyId) {
      this.startLiveRefresh();
      return;
    }

    this.stream = window.httpClient.openLobbyStream(lobbyId, this.lastStreamRevision || null);

    this.stream.addEventListener("lobby", (evt) => {
      if (!evt?.data) return;

      const payload = JSON.parse(evt.data);
      this.lastStreamRevision = Number(payload?.revision || evt.lastEventId || this.lastStreamRevision || 0);
      this.applyRealtimeSnapshot(payload);
      this.setStatus("lobby-status", "Synchronise en direct", true);
    });

    this.stream.onerror = () => {
      this.stopStream();
      this.startLiveRefresh();
      this.setStatus("lobby-status", "Flux direct indisponible, bascule en rafraichissement auto", false);
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
    this.liveInterval = setInterval(() => this.liveRefresh(), 2500);
  }

  stopLiveRefresh() {
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = null;
    }
  }

  async refreshNow() {
    await this.liveRefresh();
  }

  async liveRefresh() {
    if (this.isLiveRefreshing) return;
    const code = this.getLobbyCode();
    if (!code) return;

    this.isLiveRefreshing = true;
    try {
      const detail = await window.httpClient.getLobbyByCode(code);
      if (detail.success && detail.data?.lobby) {
        this.currentLobby = detail.data.lobby;
        this.renderLobbyInfo(detail.data);
      }

      await Promise.all([
        this.refreshPool(true),
        this.refreshRoundState(true),
        this.refreshPlayback(true),
        this.refreshScoreboard(true),
      ]);
    } finally {
      this.isLiveRefreshing = false;
    }
  }

  applyRealtimeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;

    if (snapshot.lobby) {
      this.currentLobby = snapshot.lobby;
      this.renderLobbyInfo({ lobby: snapshot.lobby, players: snapshot.players || [] });
    }

    if (snapshot.pool?.items) this.renderPool(snapshot.pool.items);
    if (snapshot.round) this.renderRound(snapshot.round);
    if (snapshot.playback) {
      const txt = `state=${snapshot.playback.playback_state ?? "?"}, track=${snapshot.playback.current_track_id ?? "none"}, rev=${snapshot.playback.sync_revision ?? 0}`;
      const el = document.getElementById("playback-state");
      if (el) el.textContent = txt;
    }
    if (snapshot.scoreboard?.items) this.renderScoreboard(snapshot.scoreboard.items);
  }

  renderLobbyInfo(data) {
    const lobby = data?.lobby;
    const players = data?.players ?? [];
    const lobbyInfo = document.getElementById("lobby-info");
    const playerList = document.getElementById("lobby-players");
    const ownerOnly = document.querySelectorAll(".owner-only");

    if (lobbyInfo && lobby) {
      lobbyInfo.textContent = `${lobby.name} (${lobby.lobby_code}) - ${players.length}/${lobby.max_players}`;
    }
    if (playerList) {
      playerList.innerHTML = players.map((p) => `<li>${p.username} (${p.role}) - ${p.score}</li>`).join("");
    }

    const isOwner = Number(lobby?.owner_user_id || 0) === Number(this.user?.id || 0);
    ownerOnly.forEach((el) => {
      el.style.display = isOwner ? "" : "none";
    });
  }

  async leaveLobby() {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;

    const res = await window.httpClient.leaveLobby(lobbyId);
    this.setStatus("lobby-status", res.success ? "Lobby quitte" : (res.error || "Erreur"), res.success);
    if (res.success) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
    }
  }

  async addTrackToPool() {
    const lobbyId = this.getLobbyId();
    const trackId = Number(document.getElementById("pool-track-id")?.value ?? 0);
    if (!lobbyId || !trackId) return this.setStatus("pool-status", "track_id requis", false);
    const res = await window.httpClient.addTrackToPool(lobbyId, trackId);
    this.setStatus("pool-status", res.success ? "Track ajoute" : (res.error || "Erreur"), res.success);
    if (res.success) this.renderPool(res.data?.items ?? []);
  }

  async removeTrackFromPool() {
    const lobbyId = this.getLobbyId();
    const trackId = Number(document.getElementById("pool-track-id")?.value ?? 0);
    if (!lobbyId || !trackId) return this.setStatus("pool-status", "track_id requis", false);
    const res = await window.httpClient.removeTrackFromPool(lobbyId, trackId);
    this.setStatus("pool-status", res.success ? "Track retire" : (res.error || "Erreur"), res.success);
    if (res.success) this.renderPool(res.data?.items ?? []);
  }

  async refreshPool(silent = false) {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;
    const res = await window.httpClient.listTrackPool(lobbyId);
    if (!silent || !res.success) {
      this.setStatus("pool-status", res.success ? "Pool charge" : (res.error || "Erreur"), res.success);
    }
    if (res.success) this.renderPool(res.data?.items ?? []);
  }

  renderPool(items) {
    const el = document.getElementById("pool-list");
    if (!el) return;
    el.innerHTML = items.map((x) => `<li>#${x.track_id} - ${x.title}</li>`).join("");
  }

  async startRound() {
    const lobbyId = this.getLobbyId();
    const trackId = Number(document.getElementById("round-track-id")?.value ?? 0);
    if (!lobbyId) return;
    const res = await window.httpClient.startRound(lobbyId, trackId || null);
    this.setStatus("round-status", res.success ? "Manche demarree" : (res.error || "Erreur"), res.success);
    if (res.success) this.renderRound(res.data);
  }

  async revealRound() {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;
    const res = await window.httpClient.revealRound(lobbyId);
    this.setStatus("round-status", res.success ? "Reveal" : (res.error || "Erreur"), res.success);
    if (res.success) this.renderRound(res.data);
  }

  async finishRound() {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;
    const res = await window.httpClient.finishRound(lobbyId);
    this.setStatus("round-status", res.success ? "Manche terminee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.renderRound(res.data?.round || null);
      this.renderScoreboard(res.data?.scoreboard?.items ?? []);
    }
  }

  async refreshRoundState(silent = false) {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;
    const res = await window.httpClient.getRoundState(lobbyId);
    if (!silent || !res.success) {
      this.setStatus("round-status", res.success ? "Round charge" : (res.error || "Erreur"), res.success);
    }
    if (res.success) this.renderRound(res.data);
  }

  renderRound(data) {
    const round = data?.round;
    const info = document.getElementById("round-info");
    const answers = document.getElementById("round-answers");
    if (!info || !answers) return;

    if (!round) {
      info.textContent = "Aucune manche en cours.";
      answers.innerHTML = "";
      return;
    }

    info.textContent = `#${round.round_number} (${round.status}) - ${round.track?.title ?? ""} / ${round.track?.artist ?? ""}`;
    answers.innerHTML = (data?.answers ?? []).map((a) => `<li>${a.username}: ${a.guess_title ?? ""} | ${a.guess_artist ?? ""} => +${a.score_awarded}</li>`).join("");
  }

  async submitAnswer() {
    const lobbyId = this.getLobbyId();
    const title = document.getElementById("guess-title")?.value ?? "";
    const artist = document.getElementById("guess-artist")?.value ?? "";
    if (!lobbyId) return;
    const res = await window.httpClient.submitAnswer(lobbyId, title, artist);
    this.setStatus("answer-status", res.success ? "Reponse enregistree" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.refreshRoundState();
      this.refreshScoreboard();
    }
  }

  async refreshPlayback(silent = false) {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;
    const res = await window.httpClient.getPlaybackState(lobbyId);
    const text = res.success
      ? `state=${res.data?.playback_state ?? "?"}, track=${res.data?.current_track_id ?? "none"}, rev=${res.data?.sync_revision ?? 0}`
      : (res.error || "Erreur");

    const el = document.getElementById("playback-state");
    if (el) el.textContent = text;

    if (!silent || !res.success) {
      this.setStatus("playback-status", res.success ? "Playback charge" : (res.error || "Erreur"), res.success);
    }
  }

  async refreshScoreboard(silent = false) {
    const lobbyId = this.getLobbyId();
    if (!lobbyId) return;
    const res = await window.httpClient.getScoreboard(lobbyId);
    if (!silent || !res.success) {
      this.setStatus("scoreboard-status", res.success ? "Scoreboard charge" : (res.error || "Erreur"), res.success);
    }
    if (res.success) this.renderScoreboard(res.data?.items ?? []);
  }

  renderScoreboard(items) {
    const el = document.getElementById("scoreboard-list");
    if (!el) return;
    el.innerHTML = items.map((x) => `<li>${x.username} (${x.role}) - ${x.score}</li>`).join("");
  }

  setStatus(targetId, text, ok) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }

  destroy() {
    this.stopStream();
    this.stopLiveRefresh();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}
