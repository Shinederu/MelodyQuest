import { getCurrentLobby, setCurrentLobby, clearCurrentLobby } from "../utils/LobbyState.js";
import { loadYouTubeIframeApi } from "../utils/youtube.js?v=20260613-mobile-catchup";
import { escapeAttribute, escapeHtml, formatPlayerRole, formatRank, renderAvatar } from "../utils/ui.js?v=20260613-mobile-catchup";
import { ClockSync, recordSyncDiagnostic } from "../utils/ClockSync.js?v=20260613-mobile-catchup";

const PLAYER_VOLUME_STORAGE_KEY = "mq_game_volume";
const PLAYER_ONLY_MODE_STORAGE_KEY = "mq_game_player_only_mode";
const DEFAULT_PLAYER_VOLUME = 70;
const TIMER_RING_RADIUS = 44;
const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * TIMER_RING_RADIUS;
const PLAYER_START_SYNC_DRIFT_SECONDS = 0.75;
const PLAYER_RECOVERY_DRIFT_SECONDS = 0.95;
const PLAYER_LATE_HARD_CATCHUP_SECONDS = 0.95;
const PLAYER_SYNC_INTERVAL_MS = 1000;
const PLAYER_SYNC_COOLDOWN_MS = 2500;
const PLAYER_PLAY_RETRY_COOLDOWN_MS = 1500;
const ROUND_START_PLAY_LEAD_MS = 60;
const PRELOAD_PRIME_MS = 1400;

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
    this.localRevealVoteRoundId = 0;
    this.roundRefreshRequested = false;
    this.roundRefreshTimeout = null;
    this.advanceRefreshTimeout = null;
    this.roundRefreshInFlight = false;
    this.nextVoteRequestInFlight = false;
    this.revealVoteRequestInFlight = false;
    this.videoRenderKey = "";
    this.autoNextEnabled = false;
    this.resultNavigationTriggered = false;
    this.clockSync = new ClockSync("game");
    this.realtimeConnected = false;
    this.hasRealtimeOpened = false;
    this.lastRealtimeRevision = "";
    this.player = null;
    this.playerReady = false;
    this.playerSyncInterval = null;
    this.playerSyncTimeout = null;
    this.playerLastSeekAtMs = 0;
    this.playerLastPlayAttemptAtMs = 0;
    this.playerAudioReleasedRoundId = 0;
    this.playerHostId = "game-video-player";
    this.playerVideoId = "";
    this.playerRequestedVideoId = "";
    this.playerVisible = false;
    this.playerErrorVideoId = "";
    this.playerErrorMessage = "";
    this.preloadPlayer = null;
    this.preloadPlayerReady = false;
    this.preloadPlayerHostId = "game-video-preload-player";
    this.preloadPlayerVideoId = "";
    this.preloadPlayerRequestedVideoId = "";
    this.preloadPrimeTimeout = null;
    this.playerVolume = this.loadStoredVolume();
    this.playerOnlyMode = this.loadPlayerOnlyMode();
    this.isLobbyCodeHidden = false;
    this.suggestionModalOpen = false;
    this.suggestionSubmitInFlight = false;
    this.suggestionHoldRoundId = 0;

    document.getElementById("btn-game-submit")?.addEventListener("click", () => this.submitAnswer());
    document.getElementById("btn-game-next")?.addEventListener("click", () => this.voteNextRound(false));
    document.getElementById("btn-game-reveal")?.addEventListener("click", () => this.voteRevealRound());
    document.getElementById("btn-game-leave")?.addEventListener("click", () => this.leaveLobby());
    document.getElementById("btn-game-player-mode")?.addEventListener("click", () => this.togglePlayerOnlyMode());
    document.getElementById("btn-game-toggle-code")?.addEventListener("click", () => this.toggleLobbyCodeVisibility());
    document.getElementById("btn-game-share-lobby")?.addEventListener("click", () => this.shareLobby());
    document.getElementById("btn-game-link-tv")?.addEventListener("click", () => this.linkTv());
    document.getElementById("btn-game-suggest-correction")?.addEventListener("click", () => this.openSuggestionModal());
    document.getElementById("btn-game-suggestion-submit")?.addEventListener("click", () => this.submitSuggestion());
    document.getElementById("btn-game-suggestion-close")?.addEventListener("click", () => this.closeSuggestionModal());
    document.getElementById("btn-game-suggestion-cancel")?.addEventListener("click", () => this.closeSuggestionModal());
    document.querySelector("[data-game-suggestion-close]")?.addEventListener("click", () => this.closeSuggestionModal());
    document.getElementById("game-answer")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submitAnswer();
      }
    });
    document.getElementById("game-auto-next")?.addEventListener("change", (event) => {
      this.autoNextEnabled = Boolean(event?.target?.checked);
      this.updateRoundPresentation();
    });
    document.getElementById("game-volume")?.addEventListener("input", (event) => {
      this.handleVolumeInput(event);
    });

    this.visibilityHandler = () => {
      if (!document.hidden) {
        this.refreshGameState();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);

    this.updateVolumeUi();
    this.updatePlayerOnlyModeUi();
    this.bootstrap();
  }

  getLobbyId() {
    return Number(this.currentLobby?.id || 0);
  }

  async bootstrap() {
    const code = String(this.currentLobby?.lobby_code || "");
    if (!code) {
      clearCurrentLobby();
      window.appCtrl.changeView("main");
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
    }, roundState.meta);

    this.startRealtime();
    this.startHeartbeat();
    this.startPlayerSyncLoop();
  }

  applySnapshot(snapshot = {}, roundMeta = null) {
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
      this.updateClockFromRoundState(snapshot.round, roundMeta);
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

  updateClockFromRoundState(roundState, responseMeta = null) {
    const serverTimeUnix = Number(roundState?.server_time_unix || 0);
    if (serverTimeUnix > 0) {
      this.clockSync.updateFromServerTime(serverTimeUnix, responseMeta?.timing || null);
    }
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
    this.localRevealVoteRoundId = 0;
    this.roundRefreshRequested = false;
    this.nextVoteRequestInFlight = false;
    this.revealVoteRequestInFlight = false;
    this.videoRenderKey = "";
    this.resultNavigationTriggered = false;
    this.playerAudioReleasedRoundId = 0;
    this.playerLastPlayAttemptAtMs = 0;
    this.playerErrorVideoId = "";
    this.playerErrorMessage = "";

    if (this.roundRefreshTimeout) {
      clearTimeout(this.roundRefreshTimeout);
      this.roundRefreshTimeout = null;
    }
    if (this.advanceRefreshTimeout) {
      clearTimeout(this.advanceRefreshTimeout);
      this.advanceRefreshTimeout = null;
    }
    if (this.playerSyncTimeout) {
      clearTimeout(this.playerSyncTimeout);
      this.playerSyncTimeout = null;
    }

    const answerInput = document.getElementById("game-answer");
    if (answerInput) {
      answerInput.value = "";
      answerInput.classList.remove("is-invalid");
    }

    if (roundId) {
      window.setTimeout(() => this.focusAnswerInput(), 80);
    }

    this.setAnswerFeedback("");
    this.setStatus(roundId ? "Nouvelle manche" : "", null);
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
        this.handleSnapshot(payload);
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
      this.refreshGameState();
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
    const progress = document.getElementById("game-progress");
    const round = this.roundState?.round;
    const currentRoundNumber = Number(round?.round_number || this.currentLobby?.current_round_number || 1);
    const totalRounds = Number(this.currentLobby?.total_rounds || 0);

    if (title) {
      title.textContent = this.currentLobby?.name || "Partie en cours";
    }
    if (progress) {
      progress.textContent = `${currentRoundNumber} / ${totalRounds}`;
    }

    this.renderLobbyCode();
  }

  renderLobbyCode() {
    const code = String(this.currentLobby?.lobby_code || "").trim();
    const button = document.getElementById("btn-game-toggle-code");
    const label = document.getElementById("game-lobby-code");
    const hint = document.getElementById("game-lobby-code-hint");

    if (button) {
      button.setAttribute("aria-pressed", this.isLobbyCodeHidden ? "true" : "false");
      button.classList.toggle("is-masked", this.isLobbyCodeHidden);
    }
    if (label) {
      label.textContent = this.isLobbyCodeHidden && code ? "*".repeat(code.length) : (code || "------");
    }
    if (hint) {
      hint.textContent = this.isLobbyCodeHidden ? "Afficher" : "Masquer";
    }
  }

  toggleLobbyCodeVisibility() {
    this.isLobbyCodeHidden = !this.isLobbyCodeHidden;
    this.renderLobbyCode();
  }

  async shareLobby() {
    const code = String(this.currentLobby?.lobby_code || "").trim().toUpperCase();
    if (!code) {
      this.setStatus("Code de salon indisponible", false);
      return;
    }

    const url = `${window.location.origin}${window.location.pathname}#/lobby?code=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.setStatus("Lien du salon copié", true);
    } catch {
      this.setStatus(url, null);
    }
  }

  linkTv() {
    window.appCtrl.changeView("tv-link?from=game");
  }

  togglePlayerOnlyMode() {
    this.playerOnlyMode = !this.playerOnlyMode;
    localStorage.setItem(PLAYER_ONLY_MODE_STORAGE_KEY, this.playerOnlyMode ? "1" : "0");
    if (this.playerOnlyMode) {
      this.destroyPlayer();
      this.destroyPreloadPlayer();
      this.videoRenderKey = "player-only";
      this.setStatus("Mode joueur activé", true);
    } else {
      this.setStatus("Mode complet activé", true);
    }
    this.updatePlayerOnlyModeUi();
    this.updateRoundPresentation();
  }

  loadPlayerOnlyMode() {
    return localStorage.getItem(PLAYER_ONLY_MODE_STORAGE_KEY) === "1";
  }

  updatePlayerOnlyModeUi() {
    const page = document.querySelector(".mq-game-page");
    page?.classList.toggle("is-player-only-mode", this.playerOnlyMode);

    const button = document.getElementById("btn-game-player-mode");
    if (button) {
      button.setAttribute("aria-pressed", this.playerOnlyMode ? "true" : "false");
      button.textContent = this.playerOnlyMode ? "Mode complet" : "Mode joueur";
      button.classList.toggle("is-active", this.playerOnlyMode);
    }

    const summary = document.getElementById("game-player-mode-summary");
    if (summary && !this.playerOnlyMode) {
      summary.hidden = true;
      summary.textContent = "";
    }
  }

  renderScoreboard() {
    const list = document.getElementById("game-scoreboard");
    if (!list) return;

    const fallbackEntries = this.players.map((player, index) => ({
      user_id: Number(player.user_id || 0),
      username: String(player.username || "joueur"),
      avatar_url: String(player.avatar_url || ""),
      role: String(player.role || "player"),
      score: Number(player.score || 0),
      _order: index,
    }));
    const source = (this.scoreboard?.length ? this.scoreboard : fallbackEntries)
      .map((entry, index) => ({
        user_id: Number(entry.user_id || 0),
        username: String(entry.username || "joueur"),
        avatar_url: String(entry.avatar_url || ""),
        role: String(entry.role || "player"),
        score: Number(entry.score || 0),
        _order: index,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a._order - b._order;
      });

    const solvedUsers = new Set((this.roundState?.answers || [])
      .filter((answer) => Number(answer?.score_awarded || 0) > 0)
      .map((answer) => Number(answer.user_id || 0)));

    list.innerHTML = source.map((entry, index) => {
      const hasSolved = solvedUsers.has(Number(entry.user_id || 0));
      return `
      <li class="mq-list-row${hasSolved ? " mq-list-row--solved" : ""}">
        <div class="mq-player-line">
          ${this.renderAvatar(entry)}
          <div>
            <strong>${this.formatRank(index + 1)} ${this.escapeHtml(entry.username)}</strong>
            <span class="mq-muted">${this.escapeHtml(this.formatPlayerRole(entry.role))}</span>
          </div>
        </div>
        <span class="mq-chip">${Number(entry.score || 0)} pt</span>
      </li>
    `;
    }).join("");
  }

  updateRoundPresentation() {
    if (this.isDestroyed) {
      return;
    }

    this.updatePlayerOnlyModeUi();

    const round = this.roundState?.round;
    if (!round) {
      this.renderPlayerOnlyRoundSummary(null);
      this.renderVideo(null, false);
      if (String(this.currentLobby?.status || "").toLowerCase() === "finished") {
        this.finishToResult(this.scoreboard || []);
        return;
      }
      this.destroyPreloadPlayer();
      if (String(this.currentLobby?.status || "").toLowerCase() === "waiting") {
        window.appCtrl.changeView("lobby");
      }
      return;
    }

    const userAnswer = this.getCurrentUserAnswer();
    const hasCorrectAnswer = this.hasCorrectAnswer(round, userAnswer);
    const pendingStart = this.isRoundPendingStart(round);
    const answerClosed = this.isAnswerWindowClosed(round);
    const revealVisible = !pendingStart && (hasCorrectAnswer || answerClosed || Boolean(round?.is_reveal_visible));
    const nextVoteAvailable = this.isNextVoteAvailable(round);
    const earlyRevealAvailable = this.isEarlyRevealVoteAvailable(round, answerClosed);

    this.renderTimer(round, answerClosed, nextVoteAvailable);
    this.renderPlayerOnlyRoundSummary(round, userAnswer, hasCorrectAnswer, answerClosed, nextVoteAvailable);
    this.renderVideo(round?.track, revealVisible, round);
    if (this.playerOnlyMode) {
      this.destroyPreloadPlayer();
    } else {
      this.ensureUpcomingPlayer(this.roundState?.next_track, round);
    }
    this.renderAnswerPhase(round, userAnswer, hasCorrectAnswer, answerClosed);
    this.renderMissedAnswerPhase(round);
    this.renderRevealVotePhase(round, earlyRevealAvailable);
    this.renderVotePhase(round, answerClosed, nextVoteAvailable);

    if (answerClosed && !this.roundRefreshRequested) {
      this.roundRefreshRequested = true;
      this.roundRefreshTimeout = window.setTimeout(() => {
        this.roundRefreshTimeout = null;
        this.refreshGameState();
      }, 200);
    }

    if (answerClosed && nextVoteAvailable && this.autoNextEnabled && !this.hasCurrentUserVoted(round) && !this.hasActiveSuggestionHold()) {
      this.voteNextRound(true);
    }
  }

  startTimerLoop() {
    if (!this.roundState?.round) {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      return;
    }

    if (this.timerInterval) {
      return;
    }

    this.timerInterval = setInterval(() => {
      if (this.isDestroyed) return;
      this.updateRoundPresentation();
    }, 1000);
  }

  startPlayerSyncLoop() {
    this.stopPlayerSyncLoop();
    this.playerSyncInterval = setInterval(() => {
      if (this.isDestroyed) return;
      this.syncPlayerPlayback(false);
    }, PLAYER_SYNC_INTERVAL_MS);
  }

  stopPlayerSyncLoop() {
    if (this.playerSyncInterval) {
      clearInterval(this.playerSyncInterval);
      this.playerSyncInterval = null;
    }
    if (this.playerSyncTimeout) {
      clearTimeout(this.playerSyncTimeout);
      this.playerSyncTimeout = null;
    }
  }

  schedulePlayerSync(force = false, delayMs = 0) {
    if (this.playerOnlyMode) {
      return;
    }

    if (this.playerSyncTimeout) {
      clearTimeout(this.playerSyncTimeout);
      this.playerSyncTimeout = null;
    }

    this.playerSyncTimeout = window.setTimeout(() => {
      this.playerSyncTimeout = null;
      this.syncPlayerPlayback(force);
    }, Math.max(0, Number(delayMs || 0)));
  }

  renderTimer(round, answerClosed, nextVoteAvailable) {
    const title = document.getElementById("game-video-overlay-title");
    const copy = document.getElementById("game-video-overlay-copy");
    const hint = document.getElementById("game-video-overlay-hint");
    const ring = document.getElementById("game-video-ring-progress");
    if (!title || !copy || !hint || !ring) return;

    if (this.isRoundPendingStart(round)) {
      const totalMs = Math.max(1000, Number(round?.preload_seconds || 1) * 1000);
      const remainingMs = Math.max(0, this.getMsUntilRoundStart(round));
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      title.textContent = "Synchronisation";
      copy.textContent = `Départ dans ${remaining}s.`;
      hint.textContent = "Prépare-toi, la manche démarre.";
      this.renderTimerRing(ring, 1 - (remainingMs / totalMs));
      return;
    }

    if (!answerClosed) {
      const totalMs = Math.max(1000, Number(this.currentLobby?.round_duration_seconds || 30) * 1000);
      const remainingMs = Math.max(0, this.getAnswerDeadlineMs(round) - this.getNowMs());
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      title.textContent = "Vidéo cachée";
      copy.textContent = `Réponds dans ${remaining}s.`;
      hint.textContent = "Écoute l'extrait et trouve la bonne réponse pour révéler la vidéo.";
      this.renderTimerRing(ring, 1 - (remainingMs / totalMs));
      return;
    }

    if (!nextVoteAvailable) {
      const revealDelayMs = Math.max(1000, this.getRevealDelaySeconds(round) * 1000);
      const remainingMs = Math.max(0, this.getNextVoteAvailableMs(round) - this.getNowMs());
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      title.textContent = "Solution révélée";
      copy.textContent = `Passage au vote dans ${remaining}s.`;
      hint.textContent = "Observe la réponse et prépare le passage à la manche suivante.";
      this.renderTimerRing(ring, 1 - (remainingMs / revealDelayMs));
      return;
    }

    title.textContent = "Vote disponible";
    copy.textContent = "Le passage à la manche suivante est ouvert.";
    hint.textContent = "Attends le reste du lobby ou active le suivant automatique.";
    this.renderTimerRing(ring, 1);
  }

  renderTimerRing(ring, ratio) {
    if (!ring) return;

    const safeRatio = Math.max(0, Math.min(1, Number(ratio || 0)));
    ring.style.strokeDasharray = String(TIMER_RING_CIRCUMFERENCE);
    ring.style.strokeDashoffset = String(TIMER_RING_CIRCUMFERENCE * (1 - safeRatio));
  }

  renderPlayerOnlyRoundSummary(round, userAnswer = null, hasCorrectAnswer = false, answerClosed = false, nextVoteAvailable = false) {
    const summary = document.getElementById("game-player-mode-summary");
    if (!summary) return;

    if (!this.playerOnlyMode || !round) {
      summary.hidden = true;
      summary.textContent = "";
      return;
    }

    let title = "Mode joueur";
    let copy = "La vidéo n'est pas chargée sur cet appareil.";

    if (this.isRoundPendingStart(round)) {
      const remaining = Math.max(0, Math.ceil(this.getMsUntilRoundStart(round) / 1000));
      title = "Synchronisation";
      copy = `Départ dans ${remaining}s. Prépare ta réponse.`;
    } else if (!answerClosed && !hasCorrectAnswer) {
      const remainingMs = Math.max(0, this.getAnswerDeadlineMs(round) - this.getNowMs());
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      title = "Réponse ouverte";
      copy = `Il reste ${remaining}s pour trouver.`;
    } else if (hasCorrectAnswer && !answerClosed) {
      const awardedScore = Number(userAnswer?.score_awarded || this.correctUnlockedScore || 0);
      const remainingMs = Math.max(0, this.getAnswerDeadlineMs(round) - this.getNowMs());
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      title = "Bonne réponse";
      copy = awardedScore > 0
        ? `+${awardedScore} pt. Il reste ${remaining}s aux autres.`
        : `Il reste ${remaining}s aux autres.`;
    } else if (!nextVoteAvailable) {
      const remaining = Math.max(0, Math.ceil((this.getNextVoteAvailableMs(round) - this.getNowMs()) / 1000));
      title = "Solution affichée";
      copy = `Vote disponible dans ${remaining}s.`;
    } else {
      title = "Vote disponible";
      copy = "Le groupe peut passer à la manche suivante.";
    }

    const currentRoundNumber = Number(round?.round_number || this.currentLobby?.current_round_number || 0);
    const totalRounds = Number(this.currentLobby?.total_rounds || 0);
    const roundLabel = currentRoundNumber && totalRounds
      ? `Manche ${currentRoundNumber} / ${totalRounds}`
      : "Manche en cours";

    summary.hidden = false;
    summary.innerHTML = `
      <span class="mq-chip">${this.escapeHtml(roundLabel)}</span>
      <strong>${this.escapeHtml(title)}</strong>
      <span>${this.escapeHtml(copy)}</span>
    `;
  }

  renderAnswerPhase(round, userAnswer, hasCorrectAnswer, answerClosed) {
    const shell = document.getElementById("game-answer-shell");
    const locked = document.getElementById("game-answer-locked");
    const lockedTitle = document.getElementById("game-answer-locked-title");
    const lockedCopy = document.getElementById("game-answer-locked-copy");
    const suggestButton = document.getElementById("btn-game-suggest-correction");
    const input = document.getElementById("game-answer");
    const submit = document.getElementById("btn-game-submit");

    if (!shell || !locked || !lockedTitle || !lockedCopy || !input || !submit) return;

    const solutionText = this.buildSolutionText(round?.track);
    if (this.isRoundPendingStart(round)) {
      shell.hidden = true;
      locked.hidden = false;
      if (suggestButton) suggestButton.hidden = true;
      input.disabled = true;
      submit.disabled = true;
      lockedTitle.textContent = "Prépare-toi";
      lockedCopy.textContent = `Départ dans ${Math.max(0, Math.ceil(this.getMsUntilRoundStart(round) / 1000))}s.`;
      return;
    }

    if (!answerClosed && !hasCorrectAnswer) {
      shell.hidden = false;
      locked.hidden = true;
      if (suggestButton) suggestButton.hidden = true;
      input.disabled = false;
      submit.disabled = false;
      this.focusAnswerInput();
      return;
    }

    shell.hidden = true;
    locked.hidden = false;
    input.disabled = true;
    submit.disabled = true;
    input.classList.remove("is-invalid");
    if (suggestButton) suggestButton.hidden = !round?.track;

    if (hasCorrectAnswer && !answerClosed) {
      const awardedScore = Number(userAnswer?.score_awarded || this.correctUnlockedScore || 0);
      const remainingMs = Math.max(0, this.getAnswerDeadlineMs(round) - this.getNowMs());
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      lockedTitle.textContent = "Bonne réponse";
      lockedCopy.textContent = awardedScore > 0
        ? `+${awardedScore} pt. Il reste ${remaining}s aux autres.`
        : `Il reste ${remaining}s aux autres.`;
      return;
    }

    if (this.playerOnlyMode) {
      lockedTitle.textContent = "Solution sur l'écran";
      lockedCopy.textContent = "Regarde la TV ou l'écran partagé pour la réponse.";
      return;
    }

    lockedTitle.textContent = "Solution";
    lockedCopy.textContent = solutionText || "Le chrono est terminé pour cette manche.";
  }

  renderMissedAnswerPhase(round) {
    const panel = document.getElementById("game-missed-panel");
    const list = document.getElementById("game-missed-answers");
    if (!panel || !list) return;

    const roundId = Number(round?.id || 0);
    const misses = (this.roundState?.answers || [])
      .filter((answer) => Number(answer?.score_awarded || 0) <= 0)
      .filter((answer) => String(answer?.guess_title || answer?.guess_artist || "").trim())
      .slice(-5)
      .reverse();

    if (!roundId || !misses.length) {
      panel.hidden = true;
      list.innerHTML = "";
      return;
    }

    panel.hidden = false;
    list.innerHTML = misses.map((answer) => `
      <li class="mq-missed-answer">
        <span>${this.escapeHtml(answer.username || "Joueur")}</span>
        <strong>${this.escapeHtml(answer.guess_title || answer.guess_artist || "Réponse vide")}</strong>
      </li>
    `).join("");
  }

  renderRevealVotePhase(round, isAvailable) {
    const panel = document.getElementById("game-reveal-vote");
    const info = document.getElementById("game-reveal-vote-info");
    const summary = document.getElementById("game-reveal-vote-summary");
    const button = document.getElementById("btn-game-reveal");
    if (!panel || !info || !summary || !button) return;

    if (!isAvailable) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;

    const playersCount = Math.max(1, this.players.length);
    const requiredCount = playersCount;
    const voteCount = this.getEarlyRevealVoteCount(round);
    const hasVoted = this.hasCurrentUserVotedReveal(round);

    info.textContent = hasVoted
      ? "Ton vote est enregistré. La réponse sera révélée si tout le monde vote."
      : "Vote pour révéler la réponse maintenant si le groupe est bloqué.";
    summary.textContent = `${voteCount} / ${requiredCount} votes pour révéler la réponse`;
    button.disabled = hasVoted || this.revealVoteRequestInFlight;
    button.textContent = hasVoted ? "Vote enregistré" : "Révéler la réponse";
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
    const suggestionHold = this.getActiveSuggestionHold();

    summary.textContent = `${readyCount} / ${requiredCount} votes pour passer à la manche suivante`;

    if (!nextVoteAvailable) {
      const remaining = Math.max(0, Math.ceil((this.getNextVoteAvailableMs(round) - this.getNowMs()) / 1000));
      info.textContent = `Le vote sera disponible dans ${remaining}s.`;
      button.hidden = true;
      return;
    }

    if (suggestionHold) {
      const name = suggestionHold.isCurrentUser ? "toi" : (suggestionHold.username || "un joueur");
      info.textContent = `Proposition en cours par ${name}. La manche attend la fin de la correction.`;
      button.hidden = false;
      button.disabled = true;
      button.textContent = "Correction en cours";
      return;
    }

    info.textContent = hasVoted
      ? "Ton vote est enregistré. En attente du reste du lobby."
      : "Au moins 50% des joueurs doivent valider pour lancer la suite.";
    button.hidden = false;
    button.disabled = hasVoted || this.nextVoteRequestInFlight;
    button.textContent = hasVoted ? "Vote enregistré" : "Passer au suivant";
  }

  renderVideo(track, showVideo, round = null) {
    const host = document.getElementById("game-video");
    const guard = document.getElementById("game-video-guard");
    const overlay = document.getElementById("game-video-overlay");
    const overlayHint = document.getElementById("game-video-overlay-hint");
    if (!host || !overlay || !overlayHint) return;

    if (this.playerOnlyMode) {
      host.classList.add("is-concealed");
      overlay.hidden = true;
      if (guard) {
        guard.hidden = true;
      }
      this.renderRoundCategory(null);
      this.renderSolution(null, false);
      this.destroyPlayer();
      this.videoRenderKey = "player-only";
      return;
    }

    const videoId = String(track?.youtube_video_id || "");
    if (this.playerErrorVideoId && this.playerErrorVideoId !== videoId) {
      this.playerErrorVideoId = "";
      this.playerErrorMessage = "";
    }

    if (videoId && this.playerErrorVideoId === videoId) {
      host.classList.add("is-concealed");
      overlay.hidden = false;
      if (guard) {
        guard.hidden = false;
      }
      const title = document.getElementById("game-video-overlay-title");
      const copy = document.getElementById("game-video-overlay-copy");
      if (title) title.textContent = "Video indisponible";
      if (copy) copy.textContent = this.playerErrorMessage || "Impossible de lire cette piste YouTube.";
      overlayHint.textContent = "Signale la piste via une suggestion ou passe a la manche suivante.";
      this.renderRoundCategory(track);
      this.renderSolution(null, false);
      this.destroyPlayer();
      this.destroyPreloadPlayer();
      this.videoRenderKey = `${videoId}:error`;
      return;
    }

    const renderKey = `${videoId}:${showVideo ? "visible" : "hidden"}`;
    if (renderKey !== this.videoRenderKey) {
      host.classList.toggle("is-concealed", !showVideo);
      overlay.hidden = showVideo;
      if (guard) {
        guard.hidden = !showVideo;
      }
      if (!videoId) {
        overlayHint.textContent = "Aucune vidéo exploitable n'est disponible pour cette manche.";
      }
      this.videoRenderKey = renderKey;
    }

    this.renderRoundCategory(track);
    this.renderSolution(track, showVideo);
    this.ensurePlayer(videoId, showVideo, round);
  }

  renderRoundCategory(track) {
    const host = document.getElementById("game-round-category");
    if (!host) return;

    const category = String(track?.category_name || "").trim();
    const shouldShow = Boolean(category) && this.toBool(this.currentLobby?.show_track_category);
    host.hidden = !shouldShow;
    host.textContent = shouldShow ? `Catégorie : ${category}` : "";
  }

  renderSolution(track, showVideo) {
    const box = document.getElementById("game-solution");
    const category = document.getElementById("game-solution-category");
    const family = document.getElementById("game-solution-family");
    const details = document.getElementById("game-solution-track");
    if (!box || !category || !family || !details) return;

    if (!showVideo || !track) {
      box.hidden = true;
      category.hidden = true;
      category.textContent = "";
      family.textContent = "";
      details.textContent = "";
      return;
    }

    const parts = this.buildSolutionParts(track);
    box.hidden = false;
    family.textContent = parts.family || "Réponse inconnue";
    details.textContent = parts.details || "";

    if (parts.category && this.toBool(this.currentLobby?.show_track_category)) {
      category.hidden = false;
      category.textContent = parts.category;
    } else {
      category.hidden = true;
      category.textContent = "";
    }
  }

  buildSolutionText(track) {
    const parts = this.buildSolutionParts(track);
    return [parts.family, parts.details].filter(Boolean).join(" - ");
  }

  buildSolutionParts(track) {
    const family = String(track?.family_name || track?.title || "").trim();
    const title = String(track?.title || "").trim();
    const artist = String(track?.artist || "").trim();
    const category = String(track?.category_name || "").trim();
    const details = [
      title && title !== family ? title : "",
      artist,
    ].filter(Boolean).join(" - ");

    return { family, details, category };
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

  hasCurrentUserVotedReveal(round) {
    const roundId = Number(round?.id || 0);
    if (roundId > 0 && this.localRevealVoteRoundId === roundId) {
      return true;
    }

    const currentUserId = Number(this.user?.id || 0);
    return (this.roundState?.early_reveal_votes ?? [])
      .some((vote) => Number(vote.user_id || 0) === currentUserId);
  }

  getEarlyRevealVoteCount(round) {
    const currentUserId = Number(this.user?.id || 0);
    const votes = this.roundState?.early_reveal_votes ?? [];
    const serverHasCurrentVote = votes.some((vote) => Number(vote.user_id || 0) === currentUserId);
    const localVote = !serverHasCurrentVote && this.localRevealVoteRoundId === Number(round?.id || 0) ? 1 : 0;
    return votes.length + localVote;
  }

  getActiveSuggestionHold() {
    const currentUserId = Number(this.user?.id || 0);
    const holds = Array.isArray(this.roundState?.suggestion_holds)
      ? this.roundState.suggestion_holds
      : [];
    const serverHold = holds.find((hold) => Number(hold?.user_id || 0) > 0) || null;
    if (serverHold) {
      return {
        ...serverHold,
        isCurrentUser: Number(serverHold.user_id || 0) === currentUserId,
      };
    }

    return this.suggestionModalOpen
      ? { user_id: currentUserId, username: this.user?.username || "", isCurrentUser: true }
      : null;
  }

  hasActiveSuggestionHold() {
    return Boolean(this.getActiveSuggestionHold());
  }

  hasAnyCorrectAnswer() {
    return (this.roundState?.answers ?? []).some((answer) => Number(answer.score_awarded || 0) > 0);
  }

  isEarlyRevealVoteAvailable(round, answerClosed) {
    if (this.isRoundPendingStart(round)) {
      return false;
    }

    if (!this.toBool(this.currentLobby?.allow_early_reveal_vote)) {
      return false;
    }

    if (answerClosed || String(round?.status || "").toLowerCase() !== "running") {
      return false;
    }

    return !this.hasAnyCorrectAnswer();
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
    if (this.isRoundPendingStart(round)) {
      return false;
    }

    const nowMs = this.getNowMs();
    const deadlineMs = this.getAnswerDeadlineMs(round);
    const status = String(round?.status || "").toLowerCase();
    if (status === "running" && deadlineMs > 0 && nowMs < deadlineMs) {
      return false;
    }

    if (round?.is_accepting_answers === false) {
      return true;
    }

    return nowMs >= deadlineMs;
  }

  isNextVoteAvailable(round) {
    return this.getNowMs() >= this.getNextVoteAvailableMs(round);
  }

  getNowMs() {
    return this.clockSync.getNowMs();
  }

  getRoundStartMs(round) {
    const startedAtUnix = Number(round?.started_at_unix || 0);
    if (startedAtUnix > 0) {
      return startedAtUnix * 1000;
    }

    const startedAt = Date.parse(String(round?.started_at || ""));
    return Number.isNaN(startedAt) ? 0 : startedAt;
  }

  getMsUntilRoundStart(round) {
    const startMs = this.getRoundStartMs(round);
    return startMs > 0 ? Math.max(0, startMs - this.getNowMs()) : 0;
  }

  isRoundPendingStart(round) {
    if (!round?.id) {
      return false;
    }

    const remainingMs = this.getMsUntilRoundStart(round);
    return remainingMs > 0;
  }

  async submitAnswer() {
    const round = this.roundState?.round;
    if (!round) {
      this.setStatus("Aucune manche en cours", false);
      return;
    }

    if (this.isRoundPendingStart(round)) {
      this.setAnswerFeedback("Attends le départ de la manche.", "error");
      return;
    }

    if (this.isAnswerWindowClosed(round)) {
      this.setAnswerFeedback("Le temps est écoulé.", "error");
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
      this.setAnswerFeedback("Réponse requise", "error");
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
      if (/temps de r[eé]ponse est [eé]coul[eé]/i.test(String(res.error || ""))) {
        this.updateRoundPresentation();
      } else {
        this.flashWrongAnswer();
      }
      return;
    }

    if (res.data?.is_correct) {
      this.correctUnlockedRoundId = Number(round.id || 0);
      this.correctUnlockedScore = Number(res.data?.score_awarded || 0);
      this.setAnswerFeedback(`Bonne réponse, +${this.correctUnlockedScore} pt`, "success");
      this.setStatus("Bonne réponse", true);
      this.clearAnswerInput();
      this.updateRoundPresentation();
      return;
    }

    this.setAnswerFeedback("Mauvaise réponse, réessaie.", "error");
    this.setStatus("Mauvaise réponse", false);
    this.clearAnswerInput();
    this.flashWrongAnswer();
  }

  async voteRevealRound() {
    const round = this.roundState?.round;
    const answerClosed = round ? this.isAnswerWindowClosed(round) : true;
    if (!round || !this.isEarlyRevealVoteAvailable(round, answerClosed) || this.hasCurrentUserVotedReveal(round) || this.revealVoteRequestInFlight) {
      return;
    }

    this.revealVoteRequestInFlight = true;
    const res = await window.httpClient.voteRevealRound(this.getLobbyId());
    this.revealVoteRequestInFlight = false;

    if (!res.success) {
      if (this.shouldExitLobby(res.error)) {
        this.exitLobbyIfActive();
        return;
      }

      if (/d[eé]j[aà] trouv[eé]/i.test(String(res.error || ""))) {
        this.refreshGameState();
        return;
      }

      this.setStatus(res.error || "Erreur", false);
      this.updateRoundPresentation();
      return;
    }

    this.localRevealVoteRoundId = Number(round.id || 0);
    const voteCount = Number(res.data?.votes_count || this.getEarlyRevealVoteCount(round));
    const requiredCount = Number(res.data?.required_count || Math.max(1, this.players.length));
    this.setStatus(
      res.data?.revealed
        ? "Réponse révélée"
        : `Vote de révélation enregistré (${voteCount}/${requiredCount})`,
      true
    );

    if (res.data?.revealed) {
      this.roundRefreshTimeout = window.setTimeout(() => {
        this.roundRefreshTimeout = null;
        this.refreshGameState();
      }, 200);
    }

    this.updateRoundPresentation();
  }

  async voteNextRound(isAutomatic) {
    const round = this.roundState?.round;
    if (!round || !this.isNextVoteAvailable(round) || this.hasCurrentUserVoted(round) || this.nextVoteRequestInFlight || this.hasActiveSuggestionHold()) {
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
    const label = isAutomatic ? "Vote automatique enregistré" : "Vote enregistré";
    this.setStatus(
      res.data?.advanced
        ? (res.data?.finished_game ? "Fin de partie" : "Manche suivante en préparation")
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

  async openSuggestionModal() {
    const round = this.roundState?.round;
    const track = round?.track;
    if (!round || !track) {
      this.setStatus("Aucune musique à corriger pour le moment", false);
      return;
    }

    this.suggestionModalOpen = true;
    this.suggestionHoldRoundId = Number(round.id || 0);
    this.autoNextEnabled = false;
    const autoNext = document.getElementById("game-auto-next");
    if (autoNext) {
      autoNext.checked = false;
    }

    this.fillSuggestionModal(track);
    this.setSuggestionStatus("La manche est temporairement bloquée pendant ta proposition.", true);
    const modal = document.getElementById("game-suggestion-modal");
    if (modal) {
      modal.hidden = false;
    }

    this.updateRoundPresentation();

    const holdRes = await window.httpClient.holdSuggestion(this.getLobbyId(), Number(round.id || 0));
    if (!holdRes.success) {
      this.setSuggestionStatus(holdRes.error || "Impossible de bloquer la manche", false);
    }

    window.setTimeout(() => document.getElementById("game-suggestion-url")?.focus(), 60);
  }

  fillSuggestionModal(track) {
    const parts = this.buildSolutionParts(track);
    const placeholders = {
      "game-suggestion-url": track?.youtube_url || (track?.youtube_video_id ? `https://www.youtube.com/watch?v=${track.youtube_video_id}` : ""),
      "game-suggestion-alias": parts.family || "",
      "game-suggestion-title-input": track?.title || "",
      "game-suggestion-artist": track?.artist || "",
      "game-suggestion-note": "",
    };

    Object.entries(placeholders).forEach(([id, placeholder]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = "";
      el.placeholder = String(placeholder || "");
    });
  }

  async closeSuggestionModal(options = {}) {
    const release = options.release !== false;
    const modal = document.getElementById("game-suggestion-modal");
    if (modal) {
      modal.hidden = true;
    }

    const roundId = this.suggestionHoldRoundId || Number(this.roundState?.round?.id || 0);
    const hadModalOpen = this.suggestionModalOpen;
    this.suggestionModalOpen = false;
    this.suggestionSubmitInFlight = false;
    this.suggestionHoldRoundId = 0;
    this.setSuggestionStatus("");
    this.updateRoundPresentation();

    if (release && hadModalOpen && this.getLobbyId() && roundId > 0) {
      await window.httpClient.releaseSuggestionHold(this.getLobbyId(), roundId);
      this.refreshGameState();
    }
  }

  async submitSuggestion() {
    if (this.suggestionSubmitInFlight) {
      return;
    }

    const round = this.roundState?.round;
    const track = round?.track;
    if (!round || !track) {
      this.setSuggestionStatus("Aucune musique à corriger pour le moment", false);
      return;
    }

    const payload = {
      suggestion_type: "track_correction",
      lobby_id: this.getLobbyId(),
      round_id: Number(round.id || 0),
      track_id: Number(track.id || 0),
      proposed_youtube_url: this.getFieldValue("game-suggestion-url"),
      proposed_alias: this.getFieldValue("game-suggestion-alias"),
      proposed_title: this.getFieldValue("game-suggestion-title-input"),
      proposed_artist: this.getFieldValue("game-suggestion-artist"),
      note: this.getFieldValue("game-suggestion-note"),
    };

    const hasProposal = [
      payload.proposed_youtube_url,
      payload.proposed_alias,
      payload.proposed_title,
      payload.proposed_artist,
      payload.note,
    ].some(Boolean);
    if (!hasProposal) {
      this.setSuggestionStatus("Remplis au moins un champ avant d'envoyer.", false);
      return;
    }

    this.suggestionSubmitInFlight = true;
    this.setSuggestionStatus("Envoi de la proposition...", null);
    const res = await window.httpClient.submitSuggestion(payload);
    this.suggestionSubmitInFlight = false;

    if (!res.success) {
      this.setSuggestionStatus(res.error || "Erreur pendant l'envoi", false);
      return;
    }

    this.setSuggestionStatus("Proposition envoyée, merci !", true);
    this.setStatus("Proposition envoyée", true);
    await this.closeSuggestionModal({ release: true });
  }

  getFieldValue(id) {
    return String(document.getElementById(id)?.value || "").trim();
  }

  setSuggestionStatus(text, ok = null) {
    const el = document.getElementById("game-suggestion-status");
    if (!el) return;
    el.textContent = text || "";
    if (!text) {
      el.className = "status";
      return;
    }
    el.className = ok === true ? "status success" : ok === false ? "status error" : "status";
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
    }, roundRes.meta);
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

  async ensurePlayer(videoId, showVideo, round = this.roundState?.round) {
    if (this.playerOnlyMode) {
      this.playerRequestedVideoId = "";
      this.playerVisible = false;
      this.destroyPlayer();
      return;
    }

    this.playerRequestedVideoId = videoId;
    this.playerVisible = Boolean(showVideo);
    this.updateVolumeUi();
    const previewStartOffset = this.getTrackStartOffsetSeconds();
    const pendingStart = this.isRoundPendingStart(round);

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
          autoplay: pendingStart ? 0 : 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          mute: 1,
          start: previewStartOffset,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            this.playerReady = true;
            this.playerVideoId = videoId;
            this.mutePlayer();
            this.schedulePlayerSync(true, pendingStart ? 100 : 250);
          },
          onStateChange: (event) => this.handlePlayerStateChange(event),
          onError: (event) => this.handlePlayerError(event),
        },
      });
      return;
    }

    if (!this.playerReady) {
      return;
    }

    if (this.playerVideoId !== videoId) {
      this.playerVideoId = videoId;
      if (pendingStart && typeof this.player.cueVideoById === "function") {
        this.safePlayerCall(() => this.player.cueVideoById({
          videoId,
          startSeconds: previewStartOffset,
        }));
      } else {
        this.safePlayerCall(() => this.player.loadVideoById({
          videoId,
          startSeconds: previewStartOffset,
        }));
      }
      this.playerAudioReleasedRoundId = 0;
      this.playerLastPlayAttemptAtMs = 0;
      this.mutePlayer();
      this.schedulePlayerSync(true, pendingStart ? 100 : 400);
      return;
    }

    this.applyPlayerVolume();
    if (pendingStart) {
      this.schedulePlayerSync(true, 100);
    } else {
      this.ensurePlayerIsPlaying();
    }
  }

  async ensureUpcomingPlayer(track, currentRound = this.roundState?.round) {
    if (this.playerOnlyMode) {
      this.destroyPreloadPlayer();
      return;
    }

    const videoId = String(track?.youtube_video_id || "").trim();
    const currentVideoId = String(currentRound?.track?.youtube_video_id || "").trim();
    if (!videoId || videoId === currentVideoId) {
      this.destroyPreloadPlayer();
      return;
    }

    this.preloadPlayerRequestedVideoId = videoId;
    const startOffset = this.getTrackStartOffsetSeconds(track);

    let host = document.getElementById(this.preloadPlayerHostId);
    if (!host) {
      const shell = document.getElementById("game-video") || document.body;
      host = document.createElement("div");
      host.id = this.preloadPlayerHostId;
      host.className = "mq-video-preload-player";
      shell.appendChild(host);
    }

    try {
      await loadYouTubeIframeApi();
    } catch {
      return;
    }

    if (this.isDestroyed || this.preloadPlayerRequestedVideoId !== videoId) {
      return;
    }

    if (!this.preloadPlayer) {
      this.preloadPlayer = new window.YT.Player(this.preloadPlayerHostId, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          mute: 1,
          playsinline: 1,
          rel: 0,
          start: Math.floor(startOffset),
        },
        events: {
          onReady: () => {
            this.preloadPlayerReady = true;
            this.preloadPlayerVideoId = videoId;
            this.primeUpcomingPlayer(startOffset);
          },
          onError: () => this.destroyPreloadPlayer(),
        },
      });
      return;
    }

    if (!this.preloadPlayerReady) {
      return;
    }

    if (this.preloadPlayerVideoId === videoId) {
      return;
    }

    this.preloadPlayerVideoId = videoId;
    this.safePreloadPlayerCall(() => this.preloadPlayer.loadVideoById({
      videoId,
      startSeconds: Math.floor(startOffset),
    }));
    this.primeUpcomingPlayer(startOffset);
  }

  primeUpcomingPlayer(startOffset = 0) {
    if (!this.preloadPlayer || !this.preloadPlayerReady) {
      return;
    }

    if (this.preloadPrimeTimeout) {
      window.clearTimeout(this.preloadPrimeTimeout);
      this.preloadPrimeTimeout = null;
    }

    const safeOffset = Math.floor(Math.max(0, Number(startOffset || 0)));
    this.safePreloadPlayerCall(() => {
      if (typeof this.preloadPlayer.mute === "function") this.preloadPlayer.mute();
      if (typeof this.preloadPlayer.setVolume === "function") this.preloadPlayer.setVolume(0);
      if (typeof this.preloadPlayer.seekTo === "function") this.preloadPlayer.seekTo(safeOffset, true);
      if (typeof this.preloadPlayer.playVideo === "function") this.preloadPlayer.playVideo();
    });

    this.preloadPrimeTimeout = window.setTimeout(() => {
      this.preloadPrimeTimeout = null;
      this.safePreloadPlayerCall(() => {
        if (typeof this.preloadPlayer.pauseVideo === "function") this.preloadPlayer.pauseVideo();
        if (typeof this.preloadPlayer.seekTo === "function") this.preloadPlayer.seekTo(safeOffset, true);
      });
    }, PRELOAD_PRIME_MS);
  }

  handlePlayerStateChange(event) {
    if (this.playerOnlyMode || !this.player || !this.playerReady || !window.YT?.PlayerState) {
      return;
    }

    if (event?.data === window.YT.PlayerState.ENDED) {
      this.schedulePlayerSync(true, 0);
      return;
    }

    if (event?.data === window.YT.PlayerState.PLAYING) {
      this.schedulePlayerSync(false, 0);
      return;
    }

    if (event?.data === window.YT.PlayerState.PAUSED || event?.data === window.YT.PlayerState.CUED) {
      this.schedulePlayerSync(true, 150);
    }
  }

  handlePlayerError(event) {
    if (this.playerOnlyMode) {
      return;
    }

    const message = this.describeYouTubeError(event?.data);
    this.playerErrorVideoId = String(this.playerVideoId || this.playerRequestedVideoId || "");
    this.playerErrorMessage = message;
    this.setStatus(message, false);
    const hint = document.getElementById("game-video-overlay-hint");
    if (hint) {
      hint.textContent = "Le lecteur YouTube a refuse cette piste. Signale-la via une suggestion ou passe a la manche suivante.";
    }
  }

  describeYouTubeError(code) {
    const value = Number(code || 0);
    if (value === 2) {
      return "ID YouTube invalide pour cette piste.";
    }
    if (value === 5) {
      return "Cette video ne peut pas etre lue par le lecteur HTML5.";
    }
    if (value === 100) {
      return "Cette video YouTube est indisponible ou privee.";
    }
    if (value === 101 || value === 150) {
      return "Cette video YouTube interdit la lecture integree.";
    }
    return "Impossible de lire cette piste YouTube.";
  }

  syncPlayerPlayback(force = false) {
    if (this.playerOnlyMode || !this.player || !this.playerReady || !this.roundState?.round || !window.YT?.PlayerState) {
      return;
    }

    const expectedTime = this.getExpectedPlayerOffsetSeconds();
    if (expectedTime === null) {
      return;
    }

    const nowMs = Date.now();
    const currentTime = this.safePlayerRead(() => Number(this.player.getCurrentTime()), 0);
    const duration = this.getPlayerDurationSeconds();
    const state = this.safePlayerRead(() => Number(this.player.getPlayerState()), -1);
    const drift = this.computePlaybackDriftSeconds(currentTime, expectedTime, duration);
    const delta = this.computePlaybackDeltaSeconds(currentTime, expectedTime, duration);
    const pendingStart = this.isRoundPendingStart(this.roundState?.round);

    if (pendingStart) {
      this.mutePlayer();
      if (drift > 0.35 && typeof this.player.seekTo === "function") {
        this.safePlayerCall(() => this.player.seekTo(expectedTime, true));
        this.playerLastSeekAtMs = nowMs;
      }
      if (state === window.YT.PlayerState.PLAYING && typeof this.player.pauseVideo === "function") {
        this.safePlayerCall(() => this.player.pauseVideo());
      }

      const remainingMs = this.getMsUntilRoundStart(this.roundState?.round);
      const delayMs = Math.max(0, remainingMs > ROUND_START_PLAY_LEAD_MS ? remainingMs - ROUND_START_PLAY_LEAD_MS : remainingMs);
      this.schedulePlayerSync(true, delayMs);
      return;
    }

    if (this.playerAudioReleasedRoundId !== Number(this.roundState?.round?.id || 0)) {
      this.releasePlayerAudioWhenReady(state, drift, delta, nowMs, expectedTime, currentTime, duration);
      return;
    }

    const recoveryDecision = this.getPlayerRecoveryDecision({ force, drift, delta, state, nowMs, expectedTime, currentTime, duration });
    if (recoveryDecision.shouldSeek) {
      this.safePlayerCall(() => this.player.seekTo(expectedTime, true));
      this.playerLastSeekAtMs = nowMs;
      this.recordPlayerSyncDiagnostic(recoveryDecision.hard ? "seek-hard-catchup" : "seek-recovery", {
        drift,
        delta,
        expectedTime,
        currentTime,
        state,
      });
    }

    if (state !== window.YT.PlayerState.PLAYING && state !== window.YT.PlayerState.BUFFERING) {
      this.ensurePlayerIsPlaying();
    }

    this.applyPlayerVolume({ allowPlayback: false });
  }

  ensurePlayerIsPlaying() {
    if (this.playerOnlyMode || !this.player || !this.playerReady || !window.YT?.PlayerState) {
      return;
    }

    const state = this.safePlayerRead(() => Number(this.player.getPlayerState()), -1);
    if (state !== window.YT.PlayerState.PLAYING && state !== window.YT.PlayerState.BUFFERING) {
      const nowMs = Date.now();
      if ((nowMs - this.playerLastPlayAttemptAtMs) < PLAYER_PLAY_RETRY_COOLDOWN_MS) {
        return;
      }
      this.playerLastPlayAttemptAtMs = nowMs;
      this.safePlayerCall(() => this.player.playVideo());
    }
  }

  releasePlayerAudioWhenReady(state, drift, delta, nowMs, expectedTime, currentTime, duration) {
    const roundId = Number(this.roundState?.round?.id || 0);
    if (!roundId || !this.player || !window.YT?.PlayerState) {
      return false;
    }

    const playerState = window.YT.PlayerState;
    if (state === playerState.UNSTARTED || state === playerState.BUFFERING || state === playerState.CUED) {
      this.mutePlayer();
      this.ensurePlayerIsPlaying();
      return false;
    }

    if (state !== playerState.PLAYING) {
      this.mutePlayer();
      this.ensurePlayerIsPlaying();
      return false;
    }

    const recoveryDecision = this.getPlayerRecoveryDecision({
      force: true,
      drift,
      delta,
      state,
      nowMs,
      expectedTime,
      currentTime,
      duration,
      startRelease: true,
    });
    if (recoveryDecision.shouldSeek && typeof this.player.seekTo === "function") {
      this.safePlayerCall(() => this.player.seekTo(expectedTime, true));
      this.playerLastSeekAtMs = nowMs;
      this.recordPlayerSyncDiagnostic(recoveryDecision.hard ? "seek-hard-before-release" : "seek-before-release", {
        drift,
        delta,
        expectedTime,
        currentTime,
        state,
      });
      return false;
    }

    if (delta > PLAYER_LATE_HARD_CATCHUP_SECONDS) {
      this.mutePlayer();
      this.ensurePlayerIsPlaying();
      this.recordPlayerSyncDiagnostic("hold-muted-late", { drift, delta, expectedTime, currentTime, state });
      return false;
    }

    if (drift > PLAYER_START_SYNC_DRIFT_SECONDS) {
      this.recordPlayerSyncDiagnostic("release-with-drift", { drift, delta, expectedTime, currentTime, state });
    }

    this.playerAudioReleasedRoundId = roundId;
    this.applyPlayerVolume({ allowPlayback: true });
    return true;
  }

  getPlayerRecoveryDecision({ force, drift, delta, state, nowMs, expectedTime, currentTime, duration, startRelease = false }) {
    if ((nowMs - this.playerLastSeekAtMs) < PLAYER_SYNC_COOLDOWN_MS) {
      return { shouldSeek: false, hard: false };
    }

    const threshold = startRelease ? PLAYER_START_SYNC_DRIFT_SECONDS : PLAYER_RECOVERY_DRIFT_SECONDS;
    if (!(drift > threshold)) {
      return { shouldSeek: false, hard: false };
    }

    if (this.isPlayerBufferingState(state)) {
      this.recordPlayerSyncDiagnostic("skip-seek-buffering", { drift, delta, expectedTime, currentTime, state });
      return { shouldSeek: false, hard: false };
    }

    if (this.isSeekTargetBuffered(expectedTime, duration, currentTime)) {
      return { shouldSeek: true, hard: false };
    }

    if (delta > PLAYER_LATE_HARD_CATCHUP_SECONDS) {
      return { shouldSeek: true, hard: true };
    }

    this.recordPlayerSyncDiagnostic("skip-seek-unbuffered", { drift, delta, expectedTime, currentTime, state });
    return { shouldSeek: false, hard: false };
  }

  isPlayerBufferingState(state) {
    const playerState = window.YT?.PlayerState || {};
    return state === playerState.UNSTARTED
      || state === playerState.BUFFERING
      || state === playerState.CUED;
  }

  isSeekTargetBuffered(targetSeconds, durationSeconds = this.getPlayerDurationSeconds(), currentSeconds = 0) {
    const target = Number(targetSeconds || 0);
    const current = Number(currentSeconds || 0);
    if (!Number.isFinite(target) || target < 0) {
      return false;
    }

    if (Number.isFinite(current) && current >= target) {
      return true;
    }

    const duration = Number(durationSeconds || 0);
    if (!(duration > 0) || !this.player || typeof this.player.getVideoLoadedFraction !== "function") {
      return false;
    }

    const loadedFraction = this.safePlayerRead(() => Number(this.player.getVideoLoadedFraction()), 0);
    if (!(loadedFraction > 0)) {
      return false;
    }

    const loadedUntil = Math.max(0, Math.min(duration, loadedFraction * duration));
    return target <= Math.max(0, loadedUntil - 0.75);
  }

  recordPlayerSyncDiagnostic(event, details = {}) {
    recordSyncDiagnostic("game-player", event, {
      roundId: Number(this.roundState?.round?.id || 0),
      offsetMs: Math.round(this.clockSync.getOffsetMs()),
      ...details,
    });
  }

  getExpectedPlayerOffsetSeconds() {
    const round = this.roundState?.round;
    const startedAtUnix = Number(round?.started_at_unix || 0);
    if (startedAtUnix <= 0) {
      return null;
    }

    const duration = this.getPlayerDurationSeconds();
    const startOffset = this.getTrackStartOffsetSeconds(round?.track, duration);
    if (this.isRoundPendingStart(round)) {
      return startOffset;
    }

    const elapsedSeconds = Math.max(0, (this.getNowMs() / 1000) - startedAtUnix);
    const playableDuration = duration - startOffset;
    if (playableDuration > 1) {
      return startOffset + (elapsedSeconds % playableDuration);
    }

    return startOffset + elapsedSeconds;
  }

  getPlayerDurationSeconds() {
    if (!this.player || !this.playerReady) {
      return 0;
    }

    const duration = this.safePlayerRead(() => Number(this.player.getDuration()), 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  getTrackStartOffsetSeconds(track = this.roundState?.round?.track, duration = 0) {
    const offset = Math.max(0, Number(track?.start_offset_seconds || 0));
    if (duration > 1 && offset >= duration) {
      return Math.max(0, duration - 0.5);
    }

    return offset;
  }

  computePlaybackDriftSeconds(currentTime, expectedTime, duration) {
    const rawDrift = Math.abs(Number(currentTime || 0) - Number(expectedTime || 0));
    if (!(duration > 1)) {
      return rawDrift;
    }

    return Math.min(
      rawDrift,
      Math.abs((currentTime + duration) - expectedTime),
      Math.abs(currentTime - (expectedTime + duration))
    );
  }

  computePlaybackDeltaSeconds(currentTime, expectedTime, duration) {
    let delta = Number(expectedTime || 0) - Number(currentTime || 0);
    if (!(duration > 1)) {
      return delta;
    }

    const halfDuration = duration / 2;
    if (delta > halfDuration) {
      delta -= duration;
    } else if (delta < -halfDuration) {
      delta += duration;
    }
    return delta;
  }

  applyPlayerVolume({ allowPlayback = true } = {}) {
    if (!this.player || !this.playerReady) {
      return;
    }

    const roundId = Number(this.roundState?.round?.id || 0);
    const shouldKeepMuted = this.isRoundPendingStart(this.roundState?.round)
      || (roundId > 0 && this.playerAudioReleasedRoundId !== roundId)
      || this.playerVolume <= 0;

    this.safePlayerCall(() => {
      if (typeof this.player.setVolume === "function") {
        this.player.setVolume(shouldKeepMuted ? 0 : this.playerVolume);
      }

      if (shouldKeepMuted && typeof this.player.mute === "function") {
        this.player.mute();
      } else if (!shouldKeepMuted && typeof this.player.unMute === "function") {
        this.player.unMute();
        if (allowPlayback && typeof this.player.playVideo === "function") {
          this.player.playVideo();
        }
      }
    });
  }

  mutePlayer() {
    if (!this.player || !this.playerReady) {
      return;
    }

    this.safePlayerCall(() => {
      if (typeof this.player.mute === "function") this.player.mute();
      if (typeof this.player.setVolume === "function") this.player.setVolume(0);
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

  safePlayerRead(fn, fallback = null) {
    if (!this.player || typeof fn !== "function") {
      return fallback;
    }

    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  safePreloadPlayerCall(fn) {
    if (!this.preloadPlayer || typeof fn !== "function") {
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
    this.playerRequestedVideoId = "";
    this.playerVisible = false;

    const host = document.getElementById(this.playerHostId);
    if (host) {
      host.innerHTML = "";
    }
  }

  destroyPreloadPlayer() {
    if (this.preloadPrimeTimeout) {
      window.clearTimeout(this.preloadPrimeTimeout);
      this.preloadPrimeTimeout = null;
    }

    if (this.preloadPlayer) {
      this.safePreloadPlayerCall(() => this.preloadPlayer.stopVideo());
      this.safePreloadPlayerCall(() => this.preloadPlayer.destroy());
    }

    this.preloadPlayer = null;
    this.preloadPlayerReady = false;
    this.preloadPlayerVideoId = "";
    this.preloadPlayerRequestedVideoId = "";

    document.getElementById(this.preloadPlayerHostId)?.remove();
  }

  clearAnswerInput() {
    const input = document.getElementById("game-answer");
    if (!input) return;
    input.value = "";
  }

  focusAnswerInput() {
    const input = document.getElementById("game-answer");
    if (!input || input.disabled || input.hidden || document.hidden) {
      return;
    }

    window.setTimeout(() => {
      if (!input.disabled && !this.isDestroyed && document.activeElement !== input) {
        input.focus();
      }
    }, 0);
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
    return /lobby introuvable/i.test(text) || /utilisateur non pr[eé]sent/i.test(text);
  }

  exitLobbyIfActive() {
    if (this.isDestroyed) return;
    clearCurrentLobby();
    window.appCtrl.changeView("main");
  }

  formatRank(rank) {
    return formatRank(rank);
  }

  renderAvatar(player) {
    return renderAvatar(player);
  }

  formatPlayerRole(role) {
    return formatPlayerRole(role);
  }

  toBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
  }

  escapeHtml(value) {
    return escapeHtml(value);
  }

  escapeAttr(value) {
    return escapeAttribute(value);
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
    if (this.suggestionModalOpen && this.suggestionHoldRoundId > 0 && this.getLobbyId()) {
      window.httpClient.releaseSuggestionHold(this.getLobbyId(), this.suggestionHoldRoundId).catch(() => {});
    }

    this.isDestroyed = true;
    this.stopRealtime();
    this.stopHeartbeat();
    this.stopPlayerSyncLoop();
    this.destroyPlayer();
    this.destroyPreloadPlayer();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
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
