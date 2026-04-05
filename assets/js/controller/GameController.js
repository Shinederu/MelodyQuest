import { getCurrentLobby, clearCurrentLobby } from "../utils/LobbyState.js";

export class GameController {
  constructor() {
    this.user = JSON.parse(localStorage.getItem("user") || "null");
    this.currentLobby = getCurrentLobby();
    this.stream = null;
    this.lastRevision = 0;
    this.timerInterval = null;
    this.heartbeatInterval = null;

    document.getElementById("btn-game-submit")?.addEventListener("click", () => this.submitAnswer());
    document.getElementById("btn-game-reveal")?.addEventListener("click", () => this.revealNow());
    document.getElementById("btn-game-next")?.addEventListener("click", () => this.finishRound());
    document.getElementById("btn-game-leave")?.addEventListener("click", () => this.leaveLobby());

    this.bootstrap();
  }

  getLobbyId() {
    return Number(this.currentLobby?.id || 0);
  }

  async bootstrap() {
    const code = String(this.currentLobby?.lobby_code || "");
    if (!code) {
      this.setStatus("Aucun lobby selectionne", false);
      return;
    }

    const [detail, roundState, scoreboard] = await Promise.all([
      window.httpClient.getLobbyByCode(code),
      window.httpClient.getRoundState(this.getLobbyId()),
      window.httpClient.getScoreboard(this.getLobbyId()),
    ]);

    if (!detail.success || !detail.data?.lobby) {
      this.setStatus(detail.error || "Lobby introuvable", false);
      return;
    }

    this.currentLobby = detail.data.lobby;
    this.renderPlayers(detail.data.players ?? [], scoreboard.data?.items ?? []);
    this.renderLobbyHeader(detail.data.lobby);
    this.applyRoundState(roundState.data || { round: null, answers: [] });
    this.renderOwnerActions();
    this.startRealtime();
    this.startHeartbeat();
  }

  startRealtime() {
    if (typeof EventSource !== "function") return;

    try {
      this.stream = window.httpClient.openLobbyStream(this.getLobbyId(), this.lastRevision || null);
      this.stream.addEventListener("lobby", (evt) => {
        if (!evt?.data) return;
        const payload = JSON.parse(evt.data);
        this.lastRevision = Number(payload?.revision || evt.lastEventId || this.lastRevision || 0);
        this.handleSnapshot(payload);
      });
      this.stream.onerror = () => this.stopRealtime();
    } catch {
      this.stopRealtime();
    }
  }

  stopRealtime() {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
  }

  handleSnapshot(snapshot) {
    if (snapshot?.lobby) {
      this.currentLobby = snapshot.lobby;
      this.renderLobbyHeader(snapshot.lobby);
    }
    if (snapshot?.players || snapshot?.scoreboard?.items) {
      this.renderPlayers(snapshot.players ?? [], snapshot.scoreboard?.items ?? []);
    }
    if (snapshot?.round) {
      const status = String(snapshot.round?.round?.status || "").toLowerCase();
      if (status === "finished" || !snapshot.round?.round) {
        this.finishToResult(snapshot.scoreboard?.items ?? []);
        return;
      }
      this.applyRoundState(snapshot.round);
    }
  }

  renderLobbyHeader(lobby) {
    const title = document.getElementById("game-title");
    const meta = document.getElementById("game-meta");
    if (title) title.textContent = lobby?.name || "Partie en cours";
    if (meta) {
      meta.textContent = `Manche ${Number(lobby?.current_round_number || 1)} / ${Number(lobby?.total_rounds || 0)} · ${String(lobby?.lobby_code || "")}`;
    }
  }

  renderPlayers(players, scoreboard) {
    const list = document.getElementById("game-players");
    if (!list) return;

    const scoreMap = new Map((scoreboard || []).map((entry) => [Number(entry.user_id || 0), Number(entry.score || 0)]));
    list.innerHTML = (players || []).map((player) => `
      <li class="mq-list-row">
        <div>
          <strong>${this.escapeHtml(player.username || "joueur")}</strong>
          <span class="mq-muted">${this.escapeHtml(player.role || "player")}</span>
        </div>
        <span class="mq-chip">${scoreMap.get(Number(player.user_id || 0)) ?? Number(player.score || 0)} pt</span>
      </li>
    `).join("");
  }

  applyRoundState(data) {
    const round = data?.round;
    if (!round) {
      this.finishToResult([]);
      return;
    }

    const reveal = String(round.status || "").toLowerCase() === "reveal";
    const answers = data?.answers ?? [];
    const currentUserId = Number(this.user?.id || 0);
    const userAnswer = answers.find((answer) => Number(answer.user_id || 0) === currentUserId);
    const hasCorrect = Boolean(userAnswer && Number(userAnswer.score_awarded || 0) > 0);

    this.renderTimer(round, reveal);
    this.renderAnswers(answers);
    this.renderVideo(round.track, reveal || hasCorrect);
    this.renderOwnerActions(reveal);
  }

  renderTimer(round, reveal) {
    const el = document.getElementById("game-timer");
    if (!el) return;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    const duration = reveal
      ? Number(this.currentLobby?.reveal_duration_seconds || 10)
      : Number(this.currentLobby?.round_duration_seconds || 30);
    const reference = reveal ? round.reveal_started_at : round.started_at;

    if (!reference) {
      el.textContent = "--";
      return;
    }

    const tick = () => {
      const endTime = new Date(reference).getTime() + duration * 1000;
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      el.textContent = `${remaining}s`;
    };

    tick();
    this.timerInterval = setInterval(tick, 1000);
  }

  renderAnswers(answers) {
    const list = document.getElementById("game-answers");
    if (!list) return;

    list.innerHTML = answers.map((answer) => `
      <li class="mq-list-row">
        <div>
          <strong>${this.escapeHtml(answer.username || "joueur")}</strong>
          <span class="mq-muted">${this.escapeHtml(answer.guess_title || answer.guess_artist || "A repondu")}</span>
        </div>
        <span class="mq-chip">+${Number(answer.score_awarded || 0)}</span>
      </li>
    `).join("");
  }

  renderVideo(track, showVideo) {
    const host = document.getElementById("game-video");
    const solution = document.getElementById("game-solution");
    if (!host || !solution) return;

    const videoId = String(track?.youtube_video_id || "");
    if (showVideo && videoId) {
      host.innerHTML = `<iframe src="https://www.youtube.com/embed/${this.escapeAttr(videoId)}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      solution.textContent = `${track?.title || ""} - ${track?.artist || ""}`;
      solution.className = "status success";
    } else {
      host.innerHTML = `<div class="mq-video-placeholder"><p>La video reste cachee jusqu'a la revelation.</p></div>`;
      solution.textContent = "";
      solution.className = "status";
    }
  }

  renderOwnerActions(reveal = false) {
    const owner = Number(this.currentLobby?.owner_user_id || 0) === Number(this.user?.id || 0);
    const revealButton = document.getElementById("btn-game-reveal");
    const nextButton = document.getElementById("btn-game-next");
    if (revealButton) revealButton.style.display = owner && !reveal ? "" : "none";
    if (nextButton) nextButton.style.display = owner && reveal ? "" : "none";
  }

  async submitAnswer() {
    const answer = String(document.getElementById("game-answer")?.value || "").trim();
    if (!answer) {
      this.setStatus("Reponse requise", false);
      return;
    }

    const res = await window.httpClient.submitAnswer(this.getLobbyId(), answer, answer);
    this.setStatus(res.success ? "Reponse envoyee" : (res.error || "Erreur"), res.success);
    if (!res.success && this.shouldExitLobby(res.error)) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
    }
  }

  async revealNow() {
    const res = await window.httpClient.revealRound(this.getLobbyId());
    this.setStatus(res.success ? "Reponse affichee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.applyRoundState(res.data);
      return;
    }
    if (this.shouldExitLobby(res.error)) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
    }
  }

  async finishRound() {
    const res = await window.httpClient.finishRound(this.getLobbyId());
    this.setStatus(res.success ? "Manche terminee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.finishToResult(res.data?.scoreboard?.items ?? []);
      return;
    }
    if (this.shouldExitLobby(res.error)) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
    }
  }

  async leaveLobby() {
    const res = await window.httpClient.leaveLobby(this.getLobbyId());
    if (res.success) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
      return;
    }
    this.setStatus(res.error || "Erreur", false);
  }

  finishToResult(scoreboard) {
    localStorage.setItem("mq_last_scoreboard", JSON.stringify(scoreboard || []));
    window.appCtrl.changeView("result");
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
    if (!res.success && this.shouldExitLobby(res.error)) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
    }
  }

  shouldExitLobby(error) {
    const text = String(error || "");
    return /lobby introuvable/i.test(text) || /utilisateur non present/i.test(text);
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
    const el = document.getElementById("game-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }

  destroy() {
    this.stopRealtime();
    this.stopHeartbeat();
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}
