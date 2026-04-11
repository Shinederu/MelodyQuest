import { getCurrentLobby, setCurrentLobby, clearCurrentLobby } from "../utils/LobbyState.js";

const AUTO_NEXT_STORAGE_KEY = "mq_auto_next_round";
const PLAYER_VOLUME_STORAGE_KEY = "mq_game_volume";
const DEFAULT_PLAYER_VOLUME = 70;

let youtubeIframeApiPromise = null;

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeoutId = window.setTimeout(() => reject(new Error("YouTube iframe API timeout")), 15000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      if (typeof previousReady === "function") {
        previousReady();
      }
      resolve(window.YT);
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("Unable to load YouTube iframe API"));
    };
    document.head.appendChild(script);
  });

  return youtubeIframeApiPromise;
}

export class GameController {
  constructor() {
    this.user = JSON.parse(localStorage.getItem("user") || "null");
    this.currentLobby = getCurrentLobby();
    this.players = [];
    this.scoreboard = [];
    this.roundState = { round: null, answers: [] };
    this.stream = null;
    this.realtimeConfig = null;
    this.timerInterval = null;
    this.heartbeatInterval = null;
    this.isDestroyed = false;
    this.currentRoundId = 0;
    this.correctUnlockedRoundId = 0;
    this.correctUnlockedScore = 0;
    this.localNextVoteRoundId = 0;
    this.roundRefreshRequested = false;
    this.roundRefreshTimeout = null;
    this.advanceRefreshTimeout = null;
    this.roundRefreshInFlight = false;
    this.nextVoteRequestInFlight = false;
    this.videoRenderKey = "";
    this.autoNextEnabled = localStorage.getItem(AUTO_NEXT_STORAGE_KEY) === "1";
    this.resultNavigationTriggered = false;
    this.serverClockOffsetMs = 0;
    this.player = null;
    this.playerReady = false;
    this.playerHostId = "game-video-player";
    this.playerVideoId = "";
    this.playerRequestedVideoId = "";
    this.playerVisible = false;
    this.playerVolume = this.loadStoredVolume();

    document.getElementById("btn-game-submit")?.addEventListener("click", () => this.submitAnswer());
    document.getElementById("btn-game-next")?.addEventListener("click", () => this.voteNextRound(false));
    document.getElementById("btn-game-leave")?.addEventListener("click", () => this.leaveLobby());
    document.getElementById("game-answer")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submitAnswer();
      }
    });
    document.getElementById("game-auto-next")?.addEventListener("change", (event) => {
      this.autoNextEnabled = Boolean(event?.target?.checked);
      localStorage.setItem(AUTO_NEXT_STORAGE_KEY, this.autoNextEnabled ? "1" : "0");
      this.updateRoundPresentation();
    });
    document.getElementById("game-volume")?.addEventListener("input", (event) => {
      this.handleVolumeInput(event);
    });

    this.updateVolumeUi();
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

    this.applySnapshot({
      lobby: detail.data.lobby,
      players: detail.data.players ?? [],
      scoreboard: { items: scoreboard.data?.items ?? [] },
      round: roundState.data || { round: null, answers: [] },
      realtime: detail.data?.realtime ?? null,
    });

    this.startRealtime();
    this.startHeartbeat();
  }

  applySnapshot(snapshot = {}) {
    if (this.isDestroyed) {
      return;
    }

    if (snapshot?.lobby) {
      this.currentLobby = snapshot.lobby;
      setCurrentLobby(snapshot.lobby);
    }
    if (Array.isArray(snapshot?.players)) {
      this.players = snapshot.players;
    }
    if (Array.isArray(snapshot?.scoreboard?.items)) {
      this.scoreboard = snapshot.scoreboard.items;
    }
    if (snapshot?.round) {
      const serverTimeUnix = Number(snapshot.round?.server_time_unix || 0);
      if (serverTimeUnix > 0) {
        this.serverClockOffsetMs = Date.now() - (serverTimeUnix * 1000);
      }
      this.trackRoundChange(snapshot.round.round);
      this.roundState = snapshot.round;
    }
    if (snapshot?.realtime) {
      this.realtimeConfig = snapshot.realtime;
    }

    this.renderLobbyHeader();
    this.renderScoreboard();
    this.updateRoundPresentation();
    this.startTimerLoop();
  }

  trackRoundChange(round) {
    const roundId = Number(round?.id || 0);
    if (roundId === this.currentRoundId) {
      return;
    }

    this.currentRoundId = roundId;
    this.correctUnlockedRoundId = 0;
    this.correctUnlockedScore = 0;
    this.localNextVoteRoundId = 0;
    this.roundRefreshRequested = false;
    this.nextVoteRequestInFlight = false;
    this.videoRenderKey = "";
    this.resultNavigationTriggered = false;

    if (this.roundRefreshTimeout) {
      clearTimeout(this.roundRefreshTimeout);
      this.roundRefreshTimeout = null;
    }
    if (this.advanceRefreshTimeout) {
      clearTimeout(this.advanceRefreshTimeout);
      this.advanceRefreshTimeout = null;
    }

    const answerInput = document.getElementById("game-answer");
    if (answerInput) {
      answerInput.value = "";
      answerInput.classList.remove("is-invalid");
    }

    this.setAnswerFeedback("");
    this.setStatus(roundId ? "Nouvelle manche" : "", null);
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
        this.handleSnapshot(JSON.parse(evt.data));
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

  handleSnapshot(snapshot) {
    if (snapshot?.deleted) {
      this.exitLobbyIfActive();
      return;
    }

    if (Array.isArray(snapshot?.players)) {
      const currentUserId = Number(this.user?.id || 0);
      const stillPresent = snapshot.players.some((player) => Number(player.user_id || 0) === currentUserId);
      if (!stillPresent) {
        this.exitLobbyIfActive();
        return;
      }
    }

    this.applySnapshot(snapshot);
  }

  renderLobbyHeader() {
    const title = document.getElementById("game-title");
    const meta = document.getElementById("game-meta");
    const progress = document.getElementById("game-progress");
    const round = this.roundState?.round;
    const currentRoundNumber = Number(round?.round_number || this.currentLobby?.current_round_number || 1);
    const totalRounds = Number(this.currentLobby?.total_rounds || 0);

    if (title) {
      title.textContent = this.currentLobby?.name || "Partie en cours";
    }
    if (meta) {
      meta.textContent = `Code ${String(this.currentLobby?.lobby_code || "")}`;
    }
    if (progress) {
      progress.textContent = `Manche ${currentRoundNumber} / ${totalRounds}`;
    }
  }

  renderScoreboard() {
    const list = document.getElementById("game-scoreboard");
    if (!list) return;

    const fallbackEntries = this.players.map((player, index) => ({
      user_id: Number(player.user_id || 0),
      username: String(player.username || "joueur"),
      score: Number(player.score || 0),
      _order: index,
    }));
    const source = (this.scoreboard?.length ? this.scoreboard : fallbackEntries)
      .map((entry, index) => ({
        user_id: Number(entry.user_id || 0),
        username: String(entry.username || "joueur"),
        score: Number(entry.score || 0),
        _order: index,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a._order - b._order;
      });

    list.innerHTML = source.map((entry, index) => `
      <li class="mq-list-row">
        <div>
          <strong>${this.formatRank(index + 1)} ${this.escapeHtml(entry.username)}</strong>
        </div>
        <span class="mq-chip">${Number(entry.score || 0)} pt</span>
      </li>
    `).join("");
  }

  updateRoundPresentation() {
    if (this.isDestroyed) {
      return;
    }

    const round = this.roundState?.round;
    if (!round) {
      this.renderVideo(null, false);
      if (String(this.currentLobby?.status || "").toLowerCase() === "finished") {
        this.finishToResult(this.scoreboard || []);
        return;
      }
      if (String(this.currentLobby?.status || "").toLowerCase() === "waiting") {
        window.appCtrl.changeView("lobby");
      }
      return;
    }

    const userAnswer = this.getCurrentUserAnswer();
    const hasCorrectAnswer = this.hasCorrectAnswer(round, userAnswer);
    const answerClosed = this.isAnswerWindowClosed(round);
    const revealVisible = hasCorrectAnswer || answerClosed || Boolean(round?.is_reveal_visible);
    const nextVoteAvailable = this.isNextVoteAvailable(round);

    this.renderTimer(round, answerClosed, nextVoteAvailable);
    this.renderVideo(round?.track, revealVisible);
    this.renderAnswerPhase(round, userAnswer, hasCorrectAnswer, answerClosed);
    this.renderVotePhase(round, answerClosed, nextVoteAvailable);

    if (answerClosed && !this.roundRefreshRequested) {
      this.roundRefreshRequested = true;
      this.roundRefreshTimeout = window.setTimeout(() => {
        this.roundRefreshTimeout = null;
        this.refreshGameState();
      }, 200);
    }

    if (answerClosed && nextVoteAvailable && this.autoNextEnabled && !this.hasCurrentUserVoted(round)) {
      this.voteNextRound(true);
    }
  }

  startTimerLoop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (!this.roundState?.round) {
      return;
    }

    this.timerInterval = setInterval(() => {
      if (this.isDestroyed) return;
      this.updateRoundPresentation();
    }, 1000);
  }

  renderTimer(round, answerClosed, nextVoteAvailable) {
    const el = document.getElementById("game-timer");
    if (!el) return;

    if (!answerClosed) {
      const remaining = Math.max(0, Math.ceil((this.getAnswerDeadlineMs(round) - this.getNowMs()) / 1000));
      el.textContent = `${remaining}s`;
      return;
    }

    if (!nextVoteAvailable) {
      const remaining = Math.max(0, Math.ceil((this.getNextVoteAvailableMs(round) - this.getNowMs()) / 1000));
      el.textContent = `Solution ${remaining}s`;
      return;
    }

    el.textContent = "Votes";
  }

  renderAnswerPhase(round, userAnswer, hasCorrectAnswer, answerClosed) {
    const shell = document.getElementById("game-answer-shell");
    const locked = document.getElementById("game-answer-locked");
    const lockedTitle = document.getElementById("game-answer-locked-title");
    const lockedCopy = document.getElementById("game-answer-locked-copy");
    const input = document.getElementById("game-answer");
    const submit = document.getElementById("btn-game-submit");

    if (!shell || !locked || !lockedTitle || !lockedCopy || !input || !submit) return;

    const solutionText = this.buildSolutionText(round?.track);
    if (!answerClosed && !hasCorrectAnswer) {
      shell.hidden = false;
      locked.hidden = true;
      input.disabled = false;
      submit.disabled = false;
      return;
    }

    shell.hidden = true;
    locked.hidden = false;
    input.disabled = true;
    submit.disabled = true;
    input.classList.remove("is-invalid");

    if (hasCorrectAnswer && !answerClosed) {
      const awardedScore = Number(userAnswer?.score_awarded || this.correctUnlockedScore || 0);
      lockedTitle.textContent = "Bonne reponse";
      lockedCopy.textContent = awardedScore > 0
        ? `+${awardedScore} pt. La video est desormais disponible pour toi.`
        : "La video est desormais disponible pour toi.";
      return;
    }

    lockedTitle.textContent = "Solution";
    lockedCopy.textContent = solutionText || "Le chrono est termine pour cette manche.";
  }

  renderVotePhase(round, answerClosed, nextVoteAvailable) {
    const panel = document.getElementById("game-next-panel");
    const info = document.getElementById("game-next-info");
    const summary = document.getElementById("game-next-summary");
    const button = document.getElementById("btn-game-next");
    const checkbox = document.getElementById("game-auto-next");
    if (!panel || !info || !summary || !button || !checkbox) return;

    checkbox.checked = this.autoNextEnabled;

    if (!answerClosed) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;

    const playersCount = Math.max(1, this.players.length);
    const requiredCount = Math.max(1, Math.ceil(playersCount * 0.5));
    const currentUserId = Number(this.user?.id || 0);
    const serverHasCurrentVote = this.players.some((player) => Number(player.user_id || 0) === currentUserId && Number(player.is_ready || 0) === 1);
    const readyCount = this.players.filter((player) => Number(player.is_ready || 0) === 1).length
      + (!serverHasCurrentVote && this.localNextVoteRoundId === Number(round?.id || 0) ? 1 : 0);
    const hasVoted = this.hasCurrentUserVoted(round);

    summary.textContent = `${readyCount} / ${requiredCount} votes pour passer a la manche suivante`;

    if (!nextVoteAvailable) {
      const remaining = Math.max(0, Math.ceil((this.getNextVoteAvailableMs(round) - this.getNowMs()) / 1000));
      info.textContent = `Le vote sera disponible dans ${remaining}s.`;
      button.hidden = true;
      return;
    }

    info.textContent = hasVoted
      ? "Ton vote est enregistre. En attente du reste du lobby."
      : "Au moins 50% des joueurs doivent valider pour lancer la suite.";
    button.hidden = false;
    button.disabled = hasVoted || this.nextVoteRequestInFlight;
    button.textContent = hasVoted ? "Vote enregistre" : "Passer au suivant";
  }

  renderVideo(track, showVideo) {
    const host = document.getElementById("game-video");
    const solution = document.getElementById("game-solution");
    const overlay = document.getElementById("game-video-overlay");
    const overlayCopy = document.getElementById("game-video-overlay-copy");
    if (!host || !solution || !overlay || !overlayCopy) return;

    const videoId = String(track?.youtube_video_id || "");
    const renderKey = `${videoId}:${showVideo ? "visible" : "hidden"}`;
    if (renderKey !== this.videoRenderKey) {
      host.classList.toggle("is-concealed", !showVideo);
      overlay.hidden = showVideo;
      overlayCopy.textContent = videoId
        ? "Ecoute l'extrait et trouve la bonne reponse pour reveler la video."
        : "Aucune video exploitable n est disponible pour cette manche.";
      this.videoRenderKey = renderKey;
    }

    this.ensurePlayer(videoId, showVideo);

    if (showVideo) {
      solution.textContent = this.buildSolutionText(track);
      solution.className = "status success";
      return;
    }

    solution.textContent = "";
    solution.className = "status";
  }

  buildSolutionText(track) {
    const expected = String(track?.family_name || track?.title || "").trim();
    const details = [String(track?.title || "").trim(), String(track?.artist || "").trim()].filter(Boolean);
    if (!expected) {
      return details.join(" - ");
    }

    const extra = details.filter((value) => value !== expected).join(" - ");
    return [expected, extra].filter(Boolean).join(" · ");
  }

  getCurrentUserAnswer() {
    const currentUserId = Number(this.user?.id || 0);
    return (this.roundState?.answers ?? []).find((answer) => Number(answer.user_id || 0) === currentUserId) || null;
  }

  hasCorrectAnswer(round, userAnswer) {
    if (Number(userAnswer?.score_awarded || 0) > 0) {
      this.correctUnlockedRoundId = Number(round?.id || 0);
      this.correctUnlockedScore = Number(userAnswer?.score_awarded || 0);
      return true;
    }

    return this.correctUnlockedRoundId === Number(round?.id || 0);
  }

  hasCurrentUserVoted(round) {
    const roundId = Number(round?.id || 0);
    if (roundId > 0 && this.localNextVoteRoundId === roundId) {
      return true;
    }

    const currentUserId = Number(this.user?.id || 0);
    return this.players.some((player) => Number(player.user_id || 0) === currentUserId && Number(player.is_ready || 0) === 1);
  }

  getAnswerDeadlineMs(round) {
    const explicitUnix = Number(round?.answer_deadline_unix || 0);
    if (explicitUnix > 0) {
      return explicitUnix * 1000;
    }

    const explicit = Date.parse(String(round?.answer_deadline_at || ""));
    if (!Number.isNaN(explicit)) {
      return explicit;
    }

    const startedAtUnix = Number(round?.started_at_unix || 0);
    if (startedAtUnix > 0) {
      const duration = Number(this.currentLobby?.round_duration_seconds || 30) * 1000;
      return (startedAtUnix * 1000) + duration;
    }

    const startedAt = Date.parse(String(round?.started_at || ""));
    const duration = Number(this.currentLobby?.round_duration_seconds || 30) * 1000;
    return Number.isNaN(startedAt) ? this.getNowMs() : startedAt + duration;
  }

  getNextVoteAvailableMs(round) {
    const explicitUnix = Number(round?.next_vote_available_unix || 0);
    if (explicitUnix > 0) {
      return explicitUnix * 1000;
    }

    const explicit = Date.parse(String(round?.next_vote_available_at || ""));
    if (!Number.isNaN(explicit)) {
      return explicit;
    }

    return this.getAnswerDeadlineMs(round) + (this.getRevealDelaySeconds(round) * 1000);
  }

  getRevealDelaySeconds(round) {
    return Math.max(10, Number(round?.reveal_delay_seconds || this.currentLobby?.reveal_duration_seconds || 10));
  }

  isAnswerWindowClosed(round) {
    if (round?.is_accepting_answers === false) {
      return true;
    }

    return this.getNowMs() >= this.getAnswerDeadlineMs(round);
  }

  isNextVoteAvailable(round) {
    return this.getNowMs() >= this.getNextVoteAvailableMs(round);
  }

  getNowMs() {
    return Date.now() - this.serverClockOffsetMs;
  }

  async submitAnswer() {
    const round = this.roundState?.round;
    if (!round) {
      this.setStatus("Aucune manche en cours", false);
      return;
    }

    if (this.isAnswerWindowClosed(round)) {
      this.setAnswerFeedback("Le temps est ecoule.", "error");
      this.clearAnswerInput();
      this.updateRoundPresentation();
      return;
    }

    if (this.hasCorrectAnswer(round, this.getCurrentUserAnswer())) {
      return;
    }

    const input = document.getElementById("game-answer");
    const answer = String(input?.value || "").trim();
    if (!answer) {
      this.setAnswerFeedback("Reponse requise", "error");
      return;
    }

    const res = await window.httpClient.submitAnswer(this.getLobbyId(), answer, answer);
    if (!res.success) {
      if (this.shouldExitLobby(res.error)) {
        this.exitLobbyIfActive();
        return;
      }

      this.setAnswerFeedback(res.error || "Erreur", "error");
      this.clearAnswerInput();
      if (/temps de reponse est ecoule/i.test(String(res.error || ""))) {
        this.updateRoundPresentation();
      } else {
        this.flashWrongAnswer();
      }
      return;
    }

    if (res.data?.is_correct) {
      this.correctUnlockedRoundId = Number(round.id || 0);
      this.correctUnlockedScore = Number(res.data?.score_awarded || 0);
      this.setAnswerFeedback(`Bonne reponse, +${this.correctUnlockedScore} pt`, "success");
      this.setStatus("Bonne reponse", true);
      this.clearAnswerInput();
      this.updateRoundPresentation();
      return;
    }

    this.setAnswerFeedback("Mauvaise reponse, reessaie.", "error");
    this.setStatus("Mauvaise reponse", false);
    this.clearAnswerInput();
    this.flashWrongAnswer();
  }

  async voteNextRound(isAutomatic) {
    const round = this.roundState?.round;
    if (!round || !this.isNextVoteAvailable(round) || this.hasCurrentUserVoted(round) || this.nextVoteRequestInFlight) {
      return;
    }

    this.nextVoteRequestInFlight = true;
    const res = await window.httpClient.voteNextRound(this.getLobbyId());
    this.nextVoteRequestInFlight = false;

    if (!res.success) {
      if (this.shouldExitLobby(res.error)) {
        this.exitLobbyIfActive();
        return;
      }

      if (!/pas encore disponible/i.test(String(res.error || ""))) {
        this.setStatus(res.error || "Erreur", false);
      }
      return;
    }

    this.localNextVoteRoundId = Number(round.id || 0);
    if (!res.data?.advanced) {
      this.players = this.players.map((player) => (
        Number(player.user_id || 0) === Number(this.user?.id || 0)
          ? { ...player, is_ready: 1 }
          : player
      ));
    }

    const readyCount = Number(res.data?.ready_count || 0);
    const requiredCount = Number(res.data?.required_count || Math.max(1, Math.ceil(this.players.length * 0.5)));
    const label = isAutomatic ? "Vote automatique enregistre" : "Vote enregistre";
    this.setStatus(
      res.data?.advanced
        ? (res.data?.finished_game ? "Fin de partie" : "Manche suivante en preparation")
        : `${label} (${readyCount}/${requiredCount})`,
      true
    );
    if (res.data?.advanced) {
      this.advanceRefreshTimeout = window.setTimeout(() => {
        this.advanceRefreshTimeout = null;
        this.refreshGameState();
      }, 200);
    }
    this.updateRoundPresentation();
  }

  async refreshGameState() {
    if (this.isDestroyed || this.roundRefreshInFlight || !this.getLobbyId()) {
      return;
    }

    this.roundRefreshInFlight = true;
    const [roundRes, scoreRes] = await Promise.all([
      window.httpClient.getRoundState(this.getLobbyId()),
      window.httpClient.getScoreboard(this.getLobbyId()),
    ]);
    this.roundRefreshInFlight = false;

    if (this.isDestroyed) {
      return;
    }

    if (!roundRes.success) {
      if (this.shouldExitLobby(roundRes.error)) {
        this.exitLobbyIfActive();
      }
      return;
    }

    this.applySnapshot({
      lobby: this.currentLobby,
      players: this.players,
      scoreboard: { items: scoreRes.success ? (scoreRes.data?.items ?? this.scoreboard) : this.scoreboard },
      round: roundRes.data,
      realtime: this.realtimeConfig,
    });
  }

  loadStoredVolume() {
    const parsed = Number.parseInt(localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY) || "", 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_PLAYER_VOLUME;
    }

    return Math.max(0, Math.min(100, parsed));
  }

  handleVolumeInput(event) {
    const value = Math.max(0, Math.min(100, Number(event?.target?.value || 0)));
    this.playerVolume = value;
    localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(value));
    this.updateVolumeUi();
    this.applyPlayerVolume();
  }

  updateVolumeUi() {
    const input = document.getElementById("game-volume");
    const label = document.getElementById("game-volume-value");
    if (input) {
      input.value = String(this.playerVolume);
    }
    if (label) {
      label.textContent = `${this.playerVolume}%`;
    }
  }

  async ensurePlayer(videoId, showVideo) {
    this.playerRequestedVideoId = videoId;
    this.playerVisible = Boolean(showVideo);
    this.updateVolumeUi();

    let host = document.getElementById(this.playerHostId);
    if (!host) {
      const shell = document.getElementById("game-video");
      if (!shell) {
        return;
      }
      host = document.createElement("div");
      host.id = this.playerHostId;
      host.className = "mq-video-player";
      shell.prepend(host);
    }

    if (!host) {
      return;
    }

    if (!videoId) {
      this.destroyPlayer();
      return;
    }

    try {
      await loadYouTubeIframeApi();
    } catch {
      return;
    }

    if (this.isDestroyed || this.playerRequestedVideoId !== videoId) {
      return;
    }

    if (!this.player) {
      this.player = new window.YT.Player(this.playerHostId, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          disablekb: 0,
          fs: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            this.playerReady = true;
            this.playerVideoId = videoId;
            this.applyPlayerVolume();
            this.safePlayerCall(() => this.player.playVideo());
          },
          onStateChange: (event) => this.handlePlayerStateChange(event),
        },
      });
      return;
    }

    if (!this.playerReady) {
      return;
    }

    if (this.playerVideoId !== videoId) {
      this.playerVideoId = videoId;
      this.safePlayerCall(() => this.player.loadVideoById(videoId));
      this.applyPlayerVolume();
      return;
    }

    this.applyPlayerVolume();
    this.safePlayerCall(() => this.player.playVideo());
  }

  handlePlayerStateChange(event) {
    if (!this.player || !this.playerReady || !window.YT?.PlayerState) {
      return;
    }

    if (event?.data === window.YT.PlayerState.ENDED) {
      this.safePlayerCall(() => {
        this.player.seekTo(0, true);
        this.player.playVideo();
      });
    }
  }

  applyPlayerVolume() {
    if (!this.player || !this.playerReady) {
      return;
    }

    this.safePlayerCall(() => {
      if (this.playerVolume <= 0) {
        this.player.mute();
      } else {
        this.player.unMute();
        this.player.setVolume(this.playerVolume);
      }
    });
  }

  safePlayerCall(fn) {
    if (!this.player || typeof fn !== "function") {
      return;
    }

    try {
      fn();
    } catch {
      // noop
    }
  }

  destroyPlayer() {
    if (this.player) {
      this.safePlayerCall(() => this.player.stopVideo());
      this.safePlayerCall(() => this.player.destroy());
    }

    this.player = null;
    this.playerReady = false;
    this.playerVideoId = "";
  }

  clearAnswerInput() {
    const input = document.getElementById("game-answer");
    if (!input) return;
    input.value = "";
  }

  flashWrongAnswer() {
    const input = document.getElementById("game-answer");
    if (!input) return;
    input.classList.remove("is-invalid");
    void input.offsetWidth;
    input.classList.add("is-invalid");
    window.setTimeout(() => input.classList.remove("is-invalid"), 700);
  }

  setAnswerFeedback(text, kind = null) {
    const el = document.getElementById("game-answer-feedback");
    if (!el) return;
    el.textContent = text || "";
    if (!text) {
      el.className = "status";
      return;
    }
    el.className = kind === "success" ? "status success" : kind === "error" ? "status error" : "status";
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
    if (this.resultNavigationTriggered || this.isDestroyed) {
      return;
    }

    this.resultNavigationTriggered = true;
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
      this.exitLobbyIfActive();
    }
  }

  shouldExitLobby(error) {
    const text = String(error || "");
    return /lobby introuvable/i.test(text) || /utilisateur non present/i.test(text);
  }

  exitLobbyIfActive() {
    if (this.isDestroyed) return;
    clearCurrentLobby();
    window.appCtrl.changeView("main");
  }

  formatRank(rank) {
    if (rank === 1) return "1er";
    return `${rank}e`;
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

  setStatus(text, ok = null) {
    const el = document.getElementById("game-status");
    if (!el) return;
    el.textContent = text || "";
    if (ok === true) {
      el.className = "status success";
      return;
    }
    if (ok === false) {
      el.className = "status error";
      return;
    }
    el.className = "status";
  }

  destroy() {
    this.isDestroyed = true;
    this.stopRealtime();
    this.stopHeartbeat();
    this.destroyPlayer();
    if (this.roundRefreshTimeout) {
      clearTimeout(this.roundRefreshTimeout);
      this.roundRefreshTimeout = null;
    }
    if (this.advanceRefreshTimeout) {
      clearTimeout(this.advanceRefreshTimeout);
      this.advanceRefreshTimeout = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}
