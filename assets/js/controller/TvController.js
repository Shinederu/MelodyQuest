import { renderQrSvg } from "../utils/qr.js?v=20260613-double-buffer";
import { loadYouTubeIframeApi } from "../utils/youtube.js?v=20260613-double-buffer";
import { escapeHtml, renderAvatar } from "../utils/ui.js?v=20260613-double-buffer";
import { ClockSync, recordSyncDiagnostic } from "../utils/ClockSync.js?v=20260613-double-buffer";

const TV_TOKEN_STORAGE_KEY = "mq_tv_device_token";
const TV_PAIRING_POLL_INTERVAL_MS = 1000;
const TV_STATE_POLL_ACTIVE_MS = 750;
const TV_STATE_POLL_SLOW_MS = 1800;
const TV_STATE_POLL_IDLE_MS = 2400;
const TV_TIMER_INTERVAL_MS = 500;
const TV_PLAYER_VOLUME = 100;
const PLAYER_START_SYNC_DRIFT_SECONDS = 0.45;
const PLAYER_RECOVERY_DRIFT_SECONDS = 0.9;
const PLAYER_RESYNC_LEAD_SECONDS = 0;
const PLAYER_SYNC_COOLDOWN_MS = 8000;
const PLAYER_BUFFERING_SEEK_GRACE_MS = 5000;
const PLAYER_BUFFERING_HARD_DRIFT_SECONDS = 8;
const PLAYER_PLAY_RETRY_COOLDOWN_MS = 1500;
const TV_ROUND_START_PLAY_LEAD_MS = 90;
const TV_HARD_SEEK_MIN_DRIFT_SECONDS = 1.4;

export class TvController {
  constructor() {
    this.deviceToken = localStorage.getItem(TV_TOKEN_STORAGE_KEY) || "";
    this.pairingPollInterval = null;
    this.statePollInterval = null;
    this.timerInterval = null;
    this.pollInFlight = false;
    this.stateInFlight = false;
    this.isDestroyed = false;
    this.snapshot = null;
    this.clockSync = new ClockSync("tv");
    this.currentRoundId = 0;
    this.lastSnapshotRevision = "";
    this.lastRenderedLobbyKey = "";
    this.lastRenderedPlayersKey = "";
    this.lastRoundPresentationKey = "";
    this.playerHostId = "tv-video-player";
    this.player = null;
    this.playerReady = false;
    this.playerVideoId = "";
    this.playerRequestedVideoId = "";
    this.playerLastSeekAtMs = 0;
    this.playerLastLoadAtMs = 0;
    this.playerLastPlayAttemptAtMs = 0;
    this.playerAudioReleasedRoundId = 0;
    this.playerErrorVideoId = "";
    this.playerErrorMessage = "";
    this.preloadPlayer = null;
    this.preloadPlayerReady = false;
    this.preloadPlayerHostId = "tv-video-preload-player";
    this.preloadPlayerVideoId = "";
    this.preloadPlayerRequestedVideoId = "";
    this.preloadPlayerLastPlayAttemptAtMs = 0;

    document.getElementById("btn-tv-new-pairing")?.addEventListener("click", () => this.resetPairing());
    document.getElementById("btn-tv-stage-new-pairing")?.addEventListener("click", () => this.resetPairing());

    this.bootstrap();
  }

  async bootstrap() {
    if (!this.deviceToken) {
      await this.createPairing();
      return;
    }

    const response = await window.httpClient.getTvPairing(this.deviceToken);
    if (!response.success || !response.data) {
      await this.createPairing();
      return;
    }

    if (response.data.status === "linked") {
      this.startLinkedMode(response.data);
      return;
    }

    this.renderPairing(response.data);
    this.startPairingPolling();
  }

  destroy() {
    this.isDestroyed = true;
    this.stopPairingPolling();
    this.stopStatePolling();
    this.stopTimer();

    if (this.player && typeof this.player.destroy === "function") {
      this.player.destroy();
    }
    this.player = null;
    this.playerReady = false;
  }

  async createPairing() {
    this.stopPairingPolling();
    this.stopStatePolling();
    this.showPairing();
    this.setPairingStatus("Création du code TV...", null);

    try {
      const response = await window.httpClient.createTvPairing();
      if (!response.success || !response.data) {
        this.setPairingStatus(response.error || "Impossible de créer un code TV.", false);
        return;
      }

      this.deviceToken = response.data.device_token || "";
      localStorage.setItem(TV_TOKEN_STORAGE_KEY, this.deviceToken);
      this.renderPairing(response.data);
      this.startPairingPolling();
    } catch {
      this.setPairingStatus("Connexion impossible pendant la création du code.", false);
    }
  }

  resetPairing() {
    localStorage.removeItem(TV_TOKEN_STORAGE_KEY);
    this.deviceToken = "";
    this.currentRoundId = 0;
    this.snapshot = null;
    this.playerVideoId = "";
    this.playerRequestedVideoId = "";
    this.playerLastLoadAtMs = 0;
    this.playerLastPlayAttemptAtMs = 0;
    this.playerErrorVideoId = "";
    this.playerErrorMessage = "";
    this.destroyPreloadPlayer();
    if (this.player && typeof this.player.stopVideo === "function") {
      this.player.stopVideo();
    }
    this.createPairing();
  }

  renderPairing(pairing = null) {
    this.showPairing();
    const code = String(pairing?.pairing_code || "").trim().toUpperCase();
    const link = `${window.location.origin}/#/tv-link?code=${encodeURIComponent(code)}`;
    const codeEl = document.getElementById("tv-code");
    const qrEl = document.getElementById("tv-qr");
    const linkEl = document.getElementById("tv-link-url");

    if (codeEl) codeEl.textContent = code || "------";
    if (qrEl) {
      qrEl.innerHTML = code ? renderQrSvg(link) : "";
    }
    if (linkEl) {
      linkEl.textContent = code ? link : "";
    }

    this.setPairingStatus(
      code ? "Scanne le QR code depuis un téléphone connecté au salon." : "En attente du code TV...",
      code ? null : false
    );
  }

  startPairingPolling() {
    this.stopPairingPolling();
    this.pairingPollInterval = window.setInterval(() => this.pollPairing(), TV_PAIRING_POLL_INTERVAL_MS);
    this.pollPairing();
  }

  stopPairingPolling() {
    if (this.pairingPollInterval) {
      window.clearInterval(this.pairingPollInterval);
      this.pairingPollInterval = null;
    }
  }

  async pollPairing() {
    if (!this.deviceToken || this.pollInFlight) return;

    this.pollInFlight = true;
    try {
      const response = await window.httpClient.getTvPairing(this.deviceToken);
      if (!response.success || !response.data) {
        await this.createPairing();
        return;
      }

      if (response.data.status === "linked") {
        this.startLinkedMode(response.data);
      }
    } catch {
      this.setPairingStatus("Connexion temporairement indisponible.", false);
    } finally {
      this.pollInFlight = false;
    }
  }

  startLinkedMode(pairing) {
    this.stopPairingPolling();
    this.showStage();
    const label = document.getElementById("tv-stage-code");
    if (label) {
      label.textContent = pairing?.lobby_code ? `Code salon ${pairing.lobby_code}` : "Salon lié";
    }
    this.setStageStatus("TV liée. Synchronisation du salon...", true);
    this.startStatePolling();
  }

  startStatePolling() {
    this.stopStatePolling();
    this.refreshState();
  }

  stopStatePolling() {
    if (this.statePollInterval) {
      window.clearTimeout(this.statePollInterval);
      this.statePollInterval = null;
    }
  }

  async refreshState() {
    if (this.isDestroyed || !this.deviceToken) return;
    if (this.stateInFlight) {
      this.scheduleNextStatePoll();
      return;
    }

    this.stateInFlight = true;
    let shouldScheduleNextPoll = true;
    try {
      const response = await window.httpClient.getTvState(this.deviceToken);
      if (!response.success || !response.data?.snapshot) {
        if (this.shouldResetAfterStateError(response.error || response.message || "")) {
          shouldScheduleNextPoll = false;
          await this.createPairing();
        }
        return;
      }

      this.applySnapshot(response.data.snapshot, response.meta);
      if (!this.playerErrorMessage) {
        this.setStageStatus("Synchronisé", true);
      }
    } catch {
      this.setStageStatus("Connexion temporairement indisponible.", false);
    } finally {
      this.stateInFlight = false;
      if (shouldScheduleNextPoll) {
        this.scheduleNextStatePoll();
      }
    }
  }

  scheduleNextStatePoll() {
    if (this.isDestroyed || !this.deviceToken) {
      return;
    }

    this.stopStatePolling();
    this.statePollInterval = window.setTimeout(() => this.refreshState(), this.getStatePollDelayMs());
  }

  getStatePollDelayMs() {
    const round = this.snapshot?.round?.round || null;
    if (!round?.id) {
      return TV_STATE_POLL_IDLE_MS;
    }

    if (this.isRoundPendingStart(round) || this.isRoundAnswerOpen(round)) {
      return TV_STATE_POLL_ACTIVE_MS;
    }

    return TV_STATE_POLL_SLOW_MS;
  }

  shouldResetAfterStateError(message) {
    const value = String(message || "").toLowerCase();
    return value.includes("expir")
      || value.includes("introuvable")
      || value.includes("non li")
      || value.includes("salon");
  }

  applySnapshot(snapshot, responseMeta = null) {
    this.snapshot = snapshot;

    const serverTimeUnix = Number(snapshot?.round?.server_time_unix || 0);
    if (serverTimeUnix > 0) {
      this.clockSync.updateFromServerTime(serverTimeUnix, responseMeta?.timing || null);
    }

    const revision = String(snapshot?.revision ?? "");
    const revisionChanged = !revision || revision !== this.lastSnapshotRevision;
    if (revision) {
      this.lastSnapshotRevision = revision;
    }

    const roundId = Number(snapshot?.round?.round?.id || 0);
    const roundChanged = roundId !== this.currentRoundId;
    if (roundId !== this.currentRoundId) {
      this.currentRoundId = roundId;
      this.playerRequestedVideoId = "";
      this.playerAudioReleasedRoundId = 0;
      this.playerErrorVideoId = "";
      this.playerErrorMessage = "";
      this.lastRoundPresentationKey = "";
    }

    this.renderLobby(revisionChanged || roundChanged);
    this.renderPlayers(revisionChanged || roundChanged);
    this.updateRoundPresentation(revisionChanged || roundChanged);
    this.startTimer();
  }

  renderLobby(force = false) {
    const lobby = this.snapshot?.lobby || {};
    const title = document.getElementById("tv-stage-title");
    const round = this.snapshot?.round?.round;
    const progress = document.getElementById("tv-stage-round");
    const code = document.getElementById("tv-stage-code");
    const renderKey = [
      lobby.id,
      lobby.name,
      lobby.lobby_code,
      lobby.total_rounds,
      lobby.current_round_number,
      round?.id,
      round?.round_number,
    ].join(":");

    if (!force && renderKey === this.lastRenderedLobbyKey) {
      return;
    }
    this.lastRenderedLobbyKey = renderKey;

    if (title) {
      title.textContent = lobby.name || "MelodyQuest TV";
    }
    if (code && lobby.lobby_code) {
      code.textContent = `Code salon ${lobby.lobby_code}`;
    }
    if (progress) {
      const current = Number(round?.round_number || lobby.current_round_number || 0);
      const total = Number(lobby.total_rounds || 0);
      progress.textContent = current && total ? `Manche ${current} / ${total}` : "Salon en attente";
    }
  }

  renderPlayers(force = false) {
    const list = document.getElementById("tv-scoreboard");
    if (!list) return;

    const answers = this.snapshot?.round?.answers || [];
    const solvedUsers = new Set(answers
      .filter((answer) => Number(answer?.score_awarded || 0) > 0)
      .map((answer) => Number(answer.user_id || 0)));
    const players = this.snapshot?.players || [];
    const scoreboard = this.snapshot?.scoreboard?.items || [];
    const source = (scoreboard.length ? scoreboard : players)
      .map((entry, index) => ({
        user_id: Number(entry.user_id || 0),
        username: String(entry.username || "Joueur"),
        avatar_url: String(entry.avatar_url || ""),
        score: Number(entry.score || 0),
        _order: index,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a._order - b._order;
      });
    const renderKey = JSON.stringify(source.map((player) => [
      player.user_id,
      player.username,
      player.avatar_url,
      player.score,
      solvedUsers.has(player.user_id),
    ]));

    if (!force && renderKey === this.lastRenderedPlayersKey) {
      return;
    }
    this.lastRenderedPlayersKey = renderKey;

    list.innerHTML = source.length
      ? source.map((player, index) => `
        <li class="mq-list-row ${solvedUsers.has(player.user_id) ? "mq-list-row--solved" : ""}">
          <div class="mq-player-line">
            ${this.renderAvatar(player)}
            <div>
              <strong>${this.escapeHtml(player.username)}</strong>
              <span class="mq-muted">${index + 1}e - ${player.score} pt</span>
            </div>
          </div>
          ${solvedUsers.has(player.user_id) ? `<span class="mq-chip mq-chip--success">Trouvé</span>` : ""}
        </li>
      `).join("")
      : `<li class="mq-tv-empty">En attente des joueurs...</li>`;
  }

  updateRoundPresentation(force = false) {
    const round = this.snapshot?.round?.round || null;
    const track = round?.track || null;
    const pendingStart = this.isRoundPendingStart(round);
    const revealVisible = this.isRoundRevealVisible(round);
    const solutionVisible = revealVisible && this.hasTrackSolution(track);
    const acceptingAnswers = this.isRoundAnswerOpen(round);
    const hasRound = Boolean(round?.id);
    const presentationKey = this.buildRoundPresentationKey({
      round,
      track,
      pendingStart,
      revealVisible,
      acceptingAnswers,
    });

    if (!force && presentationKey === this.lastRoundPresentationKey) {
      return;
    }
    this.lastRoundPresentationKey = presentationKey;

    const categoryEl = document.getElementById("tv-round-category");
    const phaseEl = document.getElementById("tv-round-phase");
    const hintEl = document.getElementById("tv-round-hint");
    const overlayTitle = document.getElementById("tv-video-overlay-title");
    const overlayCopy = document.getElementById("tv-video-overlay-copy");

    if (categoryEl) {
      const showCategory = Boolean(this.snapshot?.lobby?.show_track_category) && track?.category_name;
      categoryEl.hidden = !showCategory;
      categoryEl.textContent = showCategory ? track.category_name : "";
    }

    if (!hasRound) {
      this.stopPlayer();
      this.setVideoConcealed(true);
      this.renderSolution(null, false);
      if (phaseEl) phaseEl.textContent = "En attente";
      if (hintEl) hintEl.textContent = "Lance une manche depuis le salon pour démarrer l'écran TV.";
      if (overlayTitle) overlayTitle.textContent = "Salon prêt";
      if (overlayCopy) overlayCopy.textContent = "La musique apparaîtra ici.";
      this.maybeCueUpcomingTrack();
      return;
    }

    if (pendingStart) {
      const remaining = Math.max(0, Math.ceil(this.getMsUntilRoundStart(round) / 1000));
      if (phaseEl) phaseEl.textContent = "Synchronisation";
      if (hintEl) hintEl.textContent = "Prépare-toi, la manche démarre.";
      if (overlayTitle) overlayTitle.textContent = "Départ imminent";
      if (overlayCopy) overlayCopy.textContent = `Départ dans ${remaining}s.`;
    } else {
      if (phaseEl) {
        phaseEl.textContent = acceptingAnswers ? "Écoute" : "Solution";
      }
      if (hintEl) {
        hintEl.textContent = acceptingAnswers
          ? "Les joueurs répondent sur leur téléphone ou ordinateur."
          : solutionVisible
            ? "La solution est affichée pour tout le monde."
            : "La solution arrive sur l'écran TV.";
      }
      if (overlayTitle) {
        overlayTitle.textContent = acceptingAnswers
          ? "Vidéo cachée"
          : solutionVisible
            ? "Solution révélée"
            : "Révélation en cours";
      }
      if (overlayCopy) {
        overlayCopy.textContent = acceptingAnswers
          ? "Écoute l'extrait."
          : solutionVisible
            ? "Regarde la réponse."
            : "La réponse va s'afficher.";
      }
    }

    this.setVideoConcealed(!solutionVisible);
    this.renderSolution(track, solutionVisible);
    if (!track?.youtube_video_id) {
      this.stopPlayer();
      this.maybeCueUpcomingTrack();
      return;
    }

    const videoId = String(track.youtube_video_id || "");
    if (this.playerErrorVideoId && this.playerErrorVideoId !== videoId) {
      this.playerErrorVideoId = "";
      this.playerErrorMessage = "";
    }
    if (videoId && this.playerErrorVideoId === videoId) {
      this.renderPlayerError();
      this.maybeCueUpcomingTrack();
      return;
    }

    this.ensurePlayer(videoId, round);
    this.maybeCueUpcomingTrack();
  }

  buildRoundPresentationKey({ round, track, pendingStart, revealVisible, acceptingAnswers }) {
    if (!round?.id) {
      return [
        "empty",
        this.snapshot?.lobby?.id || "",
        this.snapshot?.round?.next_track?.youtube_video_id || "",
      ].join(":");
    }

    const pendingSeconds = pendingStart ? Math.ceil(this.getMsUntilRoundStart(round) / 1000) : "";
    return [
      round.id,
      round.round_number,
      round.status,
      track?.youtube_video_id || "",
      track?.category_name || "",
      track?.family_name || "",
      track?.title || "",
      track?.artist || "",
      pendingStart ? "pending" : "",
      pendingSeconds,
      acceptingAnswers ? "answers" : "",
      revealVisible ? "reveal" : "",
      this.isNextVoteAvailable(round) ? "vote" : "",
      this.playerErrorVideoId || "",
    ].join(":");
  }

  renderSolution(track, visible) {
    const solution = document.getElementById("tv-solution");
    const family = document.getElementById("tv-solution-family");
    const detail = document.getElementById("tv-solution-track");
    if (!solution || !family || !detail) return;

    solution.hidden = !visible || !track;
    if (!visible || !track) return;

    family.textContent = track.family_name || "Réponse";
    detail.textContent = [track.title, track.artist].filter(Boolean).join(" - ");
  }

  hasTrackSolution(track) {
    return Boolean(track?.family_name || track?.title || track?.artist);
  }

  startTimer() {
    if (this.timerInterval) return;
    this.timerInterval = window.setInterval(() => {
      this.updateTimer();
      this.updateRoundPresentation(false);
      this.syncPlayer(this.snapshot?.round?.round);
      this.maybeCueUpcomingTrack();
    }, TV_TIMER_INTERVAL_MS);
    this.updateTimer();
  }

  stopTimer() {
    if (this.timerInterval) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateTimer() {
    const timer = this.getTimerInfo();
    const value = document.getElementById("tv-timer-value");
    const label = document.getElementById("tv-timer-label");
    const progress = document.getElementById("tv-timer-ring-progress");

    if (!timer) {
      if (value) value.textContent = "--";
      if (label) label.textContent = "En attente";
      if (progress) progress.style.strokeDashoffset = "276.46";
      return;
    }

    if (value) value.textContent = `${Math.ceil(timer.remaining)}s`;
    if (label) label.textContent = timer.label;
    if (progress) {
      const circumference = 2 * Math.PI * 44;
      const ratio = timer.total > 0 ? Math.max(0, Math.min(1, timer.remaining / timer.total)) : 0;
      progress.style.strokeDasharray = String(circumference);
      progress.style.strokeDashoffset = String(circumference * (1 - ratio));
    }
  }

  getTimerInfo() {
    const round = this.snapshot?.round?.round;
    const lobby = this.snapshot?.lobby || {};
    if (!round?.id) return null;

    if (this.isRoundPendingStart(round)) {
      return {
        label: "Préparation",
        remaining: Math.max(0, this.getMsUntilRoundStart(round) / 1000),
        total: Math.max(1, Number(round.preload_seconds || 1)),
      };
    }

    const now = this.getServerNowUnix();
    if (this.isRoundAnswerOpen(round)) {
      const deadline = Number(round.answer_deadline_unix || 0);
      if (!deadline) return null;
      return {
        label: "Réponses ouvertes",
        remaining: Math.max(0, deadline - now),
        total: Math.max(1, Number(lobby.round_duration_seconds || 1)),
      };
    }

    const deadline = Number(round.next_vote_available_unix || 0);
    if (!deadline) {
      return null;
    }

    return {
      label: "Solution affichée",
      remaining: Math.max(0, deadline - now),
      total: Math.max(1, Number(round.reveal_delay_seconds || 1)),
    };
  }

  getServerNowUnix() {
    return this.clockSync.getNowUnix();
  }

  getServerNowMs() {
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
    return startMs > 0 ? Math.max(0, startMs - this.getServerNowMs()) : 0;
  }

  isRoundPendingStart(round) {
    if (!round?.id) {
      return false;
    }

    const remainingMs = this.getMsUntilRoundStart(round);
    return remainingMs > TV_ROUND_START_PLAY_LEAD_MS;
  }

  getAnswerDeadlineMs(round) {
    const deadlineUnix = Number(round?.answer_deadline_unix || 0);
    if (deadlineUnix > 0) {
      return deadlineUnix * 1000;
    }

    const deadline = Date.parse(String(round?.answer_deadline_at || ""));
    return Number.isNaN(deadline) ? 0 : deadline;
  }

  isRoundAnswerOpen(round) {
    if (!round?.id || this.isRoundPendingStart(round)) {
      return false;
    }

    const status = String(round?.status || "").toLowerCase();
    const deadlineMs = this.getAnswerDeadlineMs(round);
    const nowMs = this.getServerNowMs();
    if (status === "running" && deadlineMs > 0) {
      return nowMs < deadlineMs;
    }

    return Boolean(round?.is_accepting_answers);
  }

  isRoundRevealVisible(round) {
    if (!round?.id || this.isRoundPendingStart(round)) {
      return false;
    }

    if (Boolean(round?.is_reveal_visible)) {
      return true;
    }

    const status = String(round?.status || "").toLowerCase();
    const deadlineMs = this.getAnswerDeadlineMs(round);
    return status === "running" && deadlineMs > 0 && this.getServerNowMs() >= deadlineMs;
  }

  isNextVoteAvailable(round) {
    const deadline = Number(round?.next_vote_available_unix || 0);
    return deadline > 0 && this.getServerNowUnix() >= deadline;
  }

  setVideoConcealed(isConcealed) {
    const shell = document.getElementById("tv-video");
    const overlay = document.getElementById("tv-video-overlay");
    if (shell) shell.classList.toggle("is-concealed", Boolean(isConcealed));
    if (overlay) overlay.hidden = !isConcealed;
  }

  async ensurePlayer(videoId, round) {
    const host = document.getElementById(this.playerHostId);
    if (!host || !videoId || !round?.id) return;

    const pendingStart = this.isRoundPendingStart(round);
    this.playerRequestedVideoId = videoId;

    try {
      const YT = await loadYouTubeIframeApi();
      if (this.playerRequestedVideoId !== videoId) return;

      if (!this.player) {
        this.playerReady = false;
        this.playerVideoId = videoId;
        this.playerLastLoadAtMs = Date.now();
        this.player = new YT.Player(this.playerHostId, {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            mute: 1,
            playsinline: 1,
            rel: 0,
            start: Math.floor(this.getTargetVideoTime(round)),
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              this.playerReady = true;
              if (this.playerRequestedVideoId !== videoId) {
                this.playerVideoId = "";
                this.ensurePlayer(this.playerRequestedVideoId, this.snapshot?.round?.round);
                return;
              }
              this.playerVideoId = videoId;
              this.preparePlayerForRoundSync(round);
              if (this.isRoundPendingStart(round)) {
                this.warmupPlayerForPendingStart(round);
              } else {
                this.syncPlayer(round, true);
              }
            },
            onError: (event) => this.handlePlayerError(event),
          },
        });
        return;
      }

      if (!this.playerReady) {
        return;
      }

      if (this.promotePreloadPlayer(videoId)) {
        this.playerAudioReleasedRoundId = 0;
        this.playerLastSeekAtMs = 0;
        this.playerLastPlayAttemptAtMs = 0;
        this.preparePlayerForRoundSync(round);
        if (pendingStart) {
          this.warmupPlayerForPendingStart(round);
        } else {
          this.syncPlayer(round, true);
        }
        return;
      }

      if (this.playerVideoId !== videoId && typeof this.player.loadVideoById === "function") {
        this.playerVideoId = videoId;
        this.playerLastLoadAtMs = Date.now();
        this.playerLastSeekAtMs = 0;
        if (typeof this.player.mute === "function") {
          this.player.mute();
        }
        if (pendingStart && typeof this.player.mute === "function") {
          this.player.mute();
        }
        this.player.loadVideoById({
          videoId,
          startSeconds: Math.floor(this.getTargetVideoTime(round)),
        });
        this.preparePlayerForRoundSync(round);
        if (pendingStart) {
          this.warmupPlayerForPendingStart(round);
        } else {
          this.syncPlayer(round, true);
        }
        return;
      }

      this.preparePlayerForRoundSync(round);
      this.syncPlayer(round);
    } catch {
      this.setStageStatus("Impossible de charger le lecteur YouTube.", false);
    }
  }

  async maybeCueUpcomingTrack() {
    const upcoming = this.getUpcomingTrack();
    const videoId = String(upcoming?.youtube_video_id || "").trim();
    if (!videoId || !this.shouldCueUpcomingTrack(videoId)) {
      if (!videoId) {
        this.destroyPreloadPlayer();
      }
      return;
    }

    await this.ensureUpcomingPlayer(upcoming);
  }

  async ensureUpcomingPlayer(track) {
    const videoId = String(track?.youtube_video_id || "").trim();
    if (!videoId || this.playerVideoId === videoId) {
      this.destroyPreloadPlayer();
      return;
    }

    this.preloadPlayerRequestedVideoId = videoId;
    const startOffset = this.getTrackStartOffsetSeconds(track);
    let host = document.getElementById(this.preloadPlayerHostId);
    if (!host) {
      const shell = document.getElementById("tv-video") || document.body;
      host = document.createElement("div");
      host.id = this.preloadPlayerHostId;
      host.className = "mq-video-preload-player";
      shell.appendChild(host);
    }

    try {
      const YT = await loadYouTubeIframeApi();
      if (this.isDestroyed || this.preloadPlayerRequestedVideoId !== videoId || !this.shouldCueUpcomingTrack(videoId)) {
        return;
      }

      if (!this.preloadPlayer) {
        this.preloadPlayerReady = false;
        this.preloadPlayerVideoId = videoId;
        this.preloadPlayer = new YT.Player(this.preloadPlayerHostId, {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            mute: 1,
            playsinline: 1,
            rel: 0,
            start: Math.floor(startOffset),
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              this.preloadPlayerReady = true;
              this.preloadPlayerVideoId = videoId;
              this.primeUpcomingPlayer(startOffset);
            },
            onError: (event) => this.handlePlayerError(event),
          },
        });
        return;
      }

      if (!this.preloadPlayerReady) {
        return;
      }

      if (this.preloadPlayerVideoId === videoId) {
        this.keepUpcomingPlayerWarm();
        return;
      }

      this.preloadPlayerVideoId = videoId;
      this.preloadPlayer.loadVideoById({
        videoId,
        startSeconds: Math.floor(startOffset),
      });
      this.primeUpcomingPlayer(startOffset);
    } catch {
      this.preloadPlayerRequestedVideoId = "";
    }
  }

  getUpcomingTrack() {
    const roundState = this.snapshot?.round || {};
    if (roundState.next_track?.youtube_video_id) {
      return roundState.next_track;
    }

    return Array.isArray(roundState.upcoming_tracks)
      ? roundState.upcoming_tracks.find((track) => track?.youtube_video_id)
      : null;
  }

  shouldCueUpcomingTrack(videoId) {
    const round = this.snapshot?.round?.round || null;
    const currentVideoId = String(round?.track?.youtube_video_id || "").trim();
    if (currentVideoId && currentVideoId === videoId) {
      return false;
    }

    return this.playerVideoId !== videoId;
  }

  primeUpcomingPlayer(startOffset = 0) {
    if (!this.preloadPlayer || !this.preloadPlayerReady) {
      return;
    }

    const safeOffset = Math.floor(Math.max(0, Number(startOffset || 0)));
    this.safePreloadPlayerCall(() => {
      if (typeof this.preloadPlayer.mute === "function") this.preloadPlayer.mute();
      if (typeof this.preloadPlayer.setVolume === "function") this.preloadPlayer.setVolume(0);
      if (typeof this.preloadPlayer.seekTo === "function") this.preloadPlayer.seekTo(safeOffset, false);
    });
    this.keepUpcomingPlayerWarm();
  }

  keepUpcomingPlayerWarm() {
    if (!this.preloadPlayer || !this.preloadPlayerReady) {
      return;
    }

    this.safePreloadPlayerCall(() => {
      if (typeof this.preloadPlayer.mute === "function") this.preloadPlayer.mute();
      if (typeof this.preloadPlayer.setVolume === "function") this.preloadPlayer.setVolume(0);
      if (
        typeof this.preloadPlayer.playVideo === "function"
        && (Date.now() - this.preloadPlayerLastPlayAttemptAtMs) >= PLAYER_PLAY_RETRY_COOLDOWN_MS
      ) {
        this.preloadPlayerLastPlayAttemptAtMs = Date.now();
        this.preloadPlayer.playVideo();
      }
    });
  }

  promotePreloadPlayer(videoId) {
    if (!this.preloadPlayer || !this.preloadPlayerReady || this.preloadPlayerVideoId !== videoId) {
      return false;
    }

    const activeHost = document.getElementById(this.playerHostId);
    const preloadHost = document.getElementById(this.preloadPlayerHostId);
    if (activeHost && preloadHost) {
      activeHost.id = "tv-video-player-swap";
      preloadHost.id = this.playerHostId;
      activeHost.id = this.preloadPlayerHostId;
      preloadHost.classList.remove("mq-video-preload-player");
      preloadHost.classList.add("mq-video-player");
      activeHost.classList.remove("mq-video-player");
      activeHost.classList.add("mq-video-preload-player");
    }

    const previousPlayer = this.player;
    const previousReady = this.playerReady;
    const previousVideoId = this.playerVideoId;
    const previousRequestedVideoId = this.playerRequestedVideoId;

    this.player = this.preloadPlayer;
    this.playerReady = this.preloadPlayerReady;
    this.playerVideoId = this.preloadPlayerVideoId;
    this.playerRequestedVideoId = videoId;

    this.preloadPlayer = previousPlayer;
    this.preloadPlayerReady = previousReady;
    this.preloadPlayerVideoId = previousVideoId;
    this.preloadPlayerRequestedVideoId = previousRequestedVideoId;
    this.preloadPlayerLastPlayAttemptAtMs = 0;

    this.safePreloadPlayerCall(() => {
      if (typeof this.preloadPlayer.mute === "function") this.preloadPlayer.mute();
      if (typeof this.preloadPlayer.setVolume === "function") this.preloadPlayer.setVolume(0);
    });

    return true;
  }

  handlePlayerError(event) {
    if (event?.target && this.preloadPlayer && event.target === this.preloadPlayer) {
      this.destroyPreloadPlayer();
      return;
    }

    const message = this.describeYouTubeError(event?.data);
    this.playerErrorVideoId = String(this.playerVideoId || this.playerRequestedVideoId || "");
    this.playerErrorMessage = message;
    this.renderPlayerError();
  }

  renderPlayerError() {
    this.setStageStatus(this.playerErrorMessage || "Impossible de lire cette piste YouTube.", false);
    this.setVideoConcealed(true);
    this.renderSolution(null, false);
    const overlayTitle = document.getElementById("tv-video-overlay-title");
    const overlayCopy = document.getElementById("tv-video-overlay-copy");
    if (overlayTitle) overlayTitle.textContent = "Video indisponible";
    if (overlayCopy) overlayCopy.textContent = "Cette piste ne peut pas etre lue par YouTube sur cet ecran.";
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

  stopPlayer() {
    if (this.player && typeof this.player.stopVideo === "function") {
      this.player.stopVideo();
    }
    this.playerVideoId = "";
    this.playerRequestedVideoId = "";
    this.playerLastLoadAtMs = 0;
    this.playerLastPlayAttemptAtMs = 0;
    this.playerAudioReleasedRoundId = 0;
  }

  destroyPreloadPlayer() {
    if (this.preloadPlayer) {
      this.safePreloadPlayerCall(() => this.preloadPlayer.stopVideo());
      this.safePreloadPlayerCall(() => this.preloadPlayer.destroy());
    }

    this.preloadPlayer = null;
    this.preloadPlayerReady = false;
    this.preloadPlayerVideoId = "";
    this.preloadPlayerRequestedVideoId = "";
    this.preloadPlayerLastPlayAttemptAtMs = 0;

    document.getElementById(this.preloadPlayerHostId)?.remove();
  }

  warmupPlayerForPendingStart(round) {
    if (!this.playerReady || !this.player || !this.isRoundPendingStart(round)) {
      return;
    }

    const state = typeof this.player.getPlayerState === "function" ? Number(this.player.getPlayerState()) : -1;
    const nowMs = Date.now();

    try {
      if (typeof this.player.mute === "function") this.player.mute();
      if (typeof this.player.setVolume === "function") this.player.setVolume(0);

      if (
        typeof this.player.playVideo === "function"
        && state !== window.YT?.PlayerState?.PLAYING
        && state !== window.YT?.PlayerState?.BUFFERING
        && (nowMs - this.playerLastPlayAttemptAtMs) >= PLAYER_PLAY_RETRY_COOLDOWN_MS
      ) {
        this.playerLastPlayAttemptAtMs = nowMs;
        this.player.playVideo();
      }
    } catch {
      // YouTube may reject transient calls while the iframe is still booting.
    }
  }

  preparePlayerForRoundSync(round) {
    if (!this.player) return;

    const roundId = Number(round?.id || 0);
    if (this.isRoundPendingStart(round) || this.playerAudioReleasedRoundId !== roundId) {
      this.mutePlayer();
      return;
    }

    this.applyAudioState({ allowPlayback: false });
  }

  syncPlayer(round, force = false) {
    if (!this.playerReady || !this.player || !round?.id || typeof this.player.getCurrentTime !== "function") {
      return;
    }

    const nowMs = Date.now();
    const pendingStart = this.isRoundPendingStart(round);
    const wanted = this.getTargetVideoTime(round);
    const current = Number(this.player.getCurrentTime() || 0);
    const state = typeof this.player.getPlayerState === "function" ? Number(this.player.getPlayerState()) : -1;
    const duration = this.getPlayerDurationSeconds();
    const drift = this.computePlaybackDriftSeconds(current, wanted, duration);
    const delta = this.computePlaybackDeltaSeconds(current, wanted, duration);

    if (pendingStart) {
      this.warmupPlayerForPendingStart(round);
      return;
    }

    if (this.playerAudioReleasedRoundId !== Number(round.id || 0)) {
      this.releaseRoundAudioWhenReady(round, state, drift, delta, nowMs);
      return;
    }

    if (
      this.shouldSeekPlayer({
        force,
        drift,
        delta,
        state,
        nowMs,
        wanted,
        current,
        duration,
      })
      && typeof this.player.seekTo === "function"
    ) {
      const seekTime = this.getResyncTargetSeconds(wanted, duration);
      this.player.seekTo(seekTime, false);
      this.playerLastSeekAtMs = nowMs;
      this.recordPlayerSyncDiagnostic("seek-recovery", { drift, delta, wanted, seekTime, current, state });
    }

    this.applyAudioState({ allowPlayback: false });
    if (
      typeof this.player.playVideo === "function"
      && state !== window.YT?.PlayerState?.PLAYING
      && state !== window.YT?.PlayerState?.BUFFERING
      && (nowMs - this.playerLastPlayAttemptAtMs) >= PLAYER_PLAY_RETRY_COOLDOWN_MS
    ) {
      this.playerLastPlayAttemptAtMs = nowMs;
      this.player.playVideo();
    }
  }

  releaseRoundAudioWhenReady(round, state, drift, delta, nowMs) {
    const roundId = Number(round?.id || 0);
    if (!roundId) return false;
    if (this.playerAudioReleasedRoundId === roundId) {
      this.applyAudioState({ allowPlayback: false });
      return true;
    }

    const playerState = window.YT?.PlayerState || {};
    if (state === playerState.BUFFERING || state === playerState.UNSTARTED || state === playerState.CUED) {
      if (typeof this.player.mute === "function") this.player.mute();
      if (typeof this.player.setVolume === "function") this.player.setVolume(0);
      if (
        typeof this.player.playVideo === "function"
        && (nowMs - this.playerLastPlayAttemptAtMs) >= PLAYER_PLAY_RETRY_COOLDOWN_MS
      ) {
        this.playerLastPlayAttemptAtMs = nowMs;
        this.player.playVideo();
      }
      this.setStageStatus("Synchronisation du son...", true);
      return false;
    }

    if (state !== playerState.PLAYING) {
      if (typeof this.player.mute === "function") this.player.mute();
      if (
        typeof this.player.playVideo === "function"
        && (nowMs - this.playerLastPlayAttemptAtMs) >= PLAYER_PLAY_RETRY_COOLDOWN_MS
      ) {
        this.playerLastPlayAttemptAtMs = nowMs;
        this.player.playVideo();
      }
      return false;
    }

    const wanted = this.getTargetVideoTime(round);
    const current = typeof this.player.getCurrentTime === "function" ? Number(this.player.getCurrentTime() || 0) : 0;
    const duration = this.getPlayerDurationSeconds();
    const seekTime = this.getResyncTargetSeconds(wanted, duration);
    if (
      drift > PLAYER_START_SYNC_DRIFT_SECONDS
      && typeof this.player.seekTo === "function"
      && (nowMs - this.playerLastSeekAtMs) >= PLAYER_SYNC_COOLDOWN_MS
      && this.isSeekTargetBuffered(seekTime, duration, current)
    ) {
      this.player.seekTo(seekTime, false);
      this.playerLastSeekAtMs = nowMs;
      this.setStageStatus("Synchronisation du son...", true);
      this.recordPlayerSyncDiagnostic("seek-before-release", { drift, delta, wanted, seekTime, current, state });
      return false;
    }

    if (drift > PLAYER_START_SYNC_DRIFT_SECONDS) {
      this.recordPlayerSyncDiagnostic("release-with-drift", { drift, delta, wanted, current, state });
    }

    this.playerAudioReleasedRoundId = roundId;
    this.applyAudioState({ allowPlayback: true });
    return true;
  }

  shouldSeekPlayer({ force, drift, delta, state, nowMs, wanted, current, duration }) {
    if ((nowMs - this.playerLastSeekAtMs) < PLAYER_SYNC_COOLDOWN_MS) {
      return false;
    }

    const isBuffering = this.isPlayerBufferingState(state);
    if (isBuffering && (nowMs - this.playerLastLoadAtMs) < PLAYER_BUFFERING_SEEK_GRACE_MS) {
      return false;
    }

    const threshold = isBuffering ? PLAYER_BUFFERING_HARD_DRIFT_SECONDS : PLAYER_RECOVERY_DRIFT_SECONDS;
    if (!(drift > threshold)) {
      return false;
    }

    if (delta <= 0) {
      this.recordPlayerSyncDiagnostic("skip-seek-player-ahead", { drift, delta, wanted, current, state });
      return false;
    }

    if (!force && delta < TV_HARD_SEEK_MIN_DRIFT_SECONDS) {
      this.recordPlayerSyncDiagnostic("skip-seek-small-tv-drift", { drift, delta, wanted, current, state });
      return false;
    }

    if (isBuffering) {
      this.recordPlayerSyncDiagnostic("skip-seek-buffering", { drift, delta, wanted, current, state });
      return false;
    }

    const seekTime = this.getResyncTargetSeconds(wanted, duration);
    if (!this.isSeekTargetBuffered(seekTime, duration, current)) {
      this.recordPlayerSyncDiagnostic("skip-seek-unbuffered", { drift, delta, wanted, current, state });
      return false;
    }

    return true;
  }

  getResyncTargetSeconds(wantedTime, durationSeconds = this.getPlayerDurationSeconds()) {
    const wanted = Math.max(0, Number(wantedTime || 0));
    const target = wanted + PLAYER_RESYNC_LEAD_SECONDS;
    const duration = Number(durationSeconds || 0);
    if (duration > 1) {
      return Math.min(Math.max(0, duration - 0.25), target);
    }

    return target;
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

    const loadedFraction = Number(this.player.getVideoLoadedFraction() || 0);
    if (!(loadedFraction > 0)) {
      return false;
    }

    const loadedUntil = Math.max(0, Math.min(duration, loadedFraction * duration));
    return target <= Math.max(0, loadedUntil - 0.75);
  }

  recordPlayerSyncDiagnostic(event, details = {}) {
    recordSyncDiagnostic("tv-player", event, {
      roundId: Number(this.snapshot?.round?.round?.id || 0),
      offsetMs: Math.round(this.clockSync.getOffsetMs()),
      ...details,
    });
  }

  getTargetVideoTime(round) {
    const duration = this.getPlayerDurationSeconds();
    const startOffset = this.getTrackStartOffsetSeconds(round?.track, duration);
    const startedAt = Number(round?.started_at_unix || 0);
    if (!startedAt) return startOffset;

    if (this.isRoundPendingStart(round)) {
      return startOffset;
    }

    const elapsedSeconds = Math.max(0, this.getServerNowUnix() - startedAt);
    const playableDuration = duration - startOffset;
    if (playableDuration > 1) {
      return startOffset + (elapsedSeconds % playableDuration);
    }

    return Math.max(0, startOffset + elapsedSeconds);
  }

  getPlayerDurationSeconds() {
    if (!this.playerReady || !this.player || typeof this.player.getDuration !== "function") {
      return 0;
    }

    const duration = Number(this.player.getDuration() || 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  getTrackStartOffsetSeconds(track = this.snapshot?.round?.round?.track, duration = 0) {
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

  mutePlayer() {
    if (!this.player) return;

    try {
      if (typeof this.player.mute === "function") this.player.mute();
      if (typeof this.player.setVolume === "function") this.player.setVolume(0);
    } catch {
      // noop
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

  applyAudioState({ allowPlayback = true } = {}) {
    if (!this.player) return;

    if (typeof this.player.setVolume === "function") {
      this.player.setVolume(TV_PLAYER_VOLUME);
    }

    const pendingStart = this.isRoundPendingStart(this.snapshot?.round?.round);
    if (!pendingStart) {
      if (typeof this.player.unMute === "function") {
        this.player.unMute();
      }
      if (allowPlayback && typeof this.player.playVideo === "function") this.player.playVideo();
    } else if (typeof this.player.mute === "function") {
      this.player.mute();
    }
  }

  showPairing() {
    const pairing = document.getElementById("tv-pairing");
    const stage = document.getElementById("tv-stage");
    if (pairing) pairing.hidden = false;
    if (stage) stage.hidden = true;
  }

  showStage() {
    const pairing = document.getElementById("tv-pairing");
    const stage = document.getElementById("tv-stage");
    if (pairing) pairing.hidden = true;
    if (stage) stage.hidden = false;
    this.applyAudioState();
  }

  setPairingStatus(message, success = null) {
    const status = document.getElementById("tv-pairing-status");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("status-success", success === true);
    status.classList.toggle("status-error", success === false);
  }

  setStageStatus(message, success = null) {
    const status = document.getElementById("tv-stage-status");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("status-success", success === true);
    status.classList.toggle("status-error", success === false);
  }

  renderAvatar(player) {
    return renderAvatar(player, {
      fallbackName: "Joueur",
      fallbackInitials: "?",
      lazy: false,
      ariaHiddenFallback: false,
    });
  }

  escapeHtml(value) {
    return escapeHtml(value);
  }
}
