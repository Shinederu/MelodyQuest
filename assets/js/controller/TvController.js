import { renderQrSvg } from "../utils/qr.js?v=20260610-tv-stable-player";
import { loadYouTubeIframeApi } from "../utils/youtube.js?v=20260610-tv-stable-player";
import { escapeHtml, renderAvatar } from "../utils/ui.js?v=20260610-tv-stable-player";

const TV_TOKEN_STORAGE_KEY = "mq_tv_device_token";
const TV_PAIRING_POLL_INTERVAL_MS = 1000;
const TV_STATE_POLL_INTERVAL_MS = 650;
const TV_TIMER_INTERVAL_MS = 250;
const TV_PLAYER_VOLUME = 100;
const PLAYER_SYNC_DRIFT_SECONDS = 1.25;
const PLAYER_SYNC_COOLDOWN_MS = 2500;
const PLAYER_BUFFERING_SEEK_GRACE_MS = 5000;
const PLAYER_BUFFERING_HARD_DRIFT_SECONDS = 8;
const PLAYER_PLAY_RETRY_COOLDOWN_MS = 1500;
const TV_ROUND_START_PLAY_LEAD_MS = 90;
const YOUTUBE_PREFERRED_QUALITY = "hd1080";

export class TvController {
  constructor() {
    this.deviceToken = localStorage.getItem(TV_TOKEN_STORAGE_KEY) || "";
    this.pairingPollInterval = null;
    this.statePollInterval = null;
    this.timerInterval = null;
    this.pollInFlight = false;
    this.stateInFlight = false;
    this.snapshot = null;
    this.serverClockOffsetMs = 0;
    this.currentRoundId = 0;
    this.player = null;
    this.playerReady = false;
    this.playerVideoId = "";
    this.playerRequestedVideoId = "";
    this.playerLastSeekAtMs = 0;
    this.playerLastLoadAtMs = 0;
    this.playerLastPlayAttemptAtMs = 0;
    this.playerPrimingUntilMs = 0;
    this.preloadPlayer = null;
    this.preloadPlayerReady = false;
    this.preloadPlayerVideoId = "";
    this.preloadPlayerRequestedVideoId = "";

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
    this.stopPairingPolling();
    this.stopStatePolling();
    this.stopTimer();

    if (this.player && typeof this.player.destroy === "function") {
      this.player.destroy();
    }
    this.player = null;
    this.playerReady = false;
    this.destroyPreloadPlayer();
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
    this.statePollInterval = window.setInterval(() => this.refreshState(), TV_STATE_POLL_INTERVAL_MS);
    this.refreshState();
  }

  stopStatePolling() {
    if (this.statePollInterval) {
      window.clearInterval(this.statePollInterval);
      this.statePollInterval = null;
    }
  }

  async refreshState() {
    if (!this.deviceToken || this.stateInFlight) return;

    this.stateInFlight = true;
    try {
      const response = await window.httpClient.getTvState(this.deviceToken);
      if (!response.success || !response.data?.snapshot) {
        if (this.shouldResetAfterStateError(response.error || response.message || "")) {
          await this.createPairing();
        }
        return;
      }

      this.applySnapshot(response.data.snapshot);
      this.setStageStatus("Synchronisé", true);
    } catch {
      this.setStageStatus("Connexion temporairement indisponible.", false);
    } finally {
      this.stateInFlight = false;
    }
  }

  shouldResetAfterStateError(message) {
    const value = String(message || "").toLowerCase();
    return value.includes("expir")
      || value.includes("introuvable")
      || value.includes("non li")
      || value.includes("salon");
  }

  applySnapshot(snapshot) {
    this.snapshot = snapshot;

    const serverTimeUnix = Number(snapshot?.round?.server_time_unix || 0);
    if (serverTimeUnix > 0) {
      this.serverClockOffsetMs = Date.now() - serverTimeUnix * 1000;
    }

    const roundId = Number(snapshot?.round?.round?.id || 0);
    if (roundId !== this.currentRoundId) {
      this.currentRoundId = roundId;
      this.playerRequestedVideoId = "";
    }

    this.renderLobby();
    this.renderPlayers();
    this.updateRoundPresentation();
    this.startTimer();
  }

  renderLobby() {
    const lobby = this.snapshot?.lobby || {};
    const title = document.getElementById("tv-stage-title");
    const round = this.snapshot?.round?.round;
    const progress = document.getElementById("tv-stage-round");
    const code = document.getElementById("tv-stage-code");

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

  renderPlayers() {
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

  updateRoundPresentation() {
    const round = this.snapshot?.round?.round || null;
    const track = round?.track || null;
    const pendingStart = this.isRoundPendingStart(round);
    const revealVisible = this.isRoundRevealVisible(round);
    const acceptingAnswers = this.isRoundAnswerOpen(round);
    const hasRound = Boolean(round?.id);
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
      this.destroyPreloadPlayer();
      this.setVideoConcealed(true);
      this.renderSolution(null, false);
      if (phaseEl) phaseEl.textContent = "En attente";
      if (hintEl) hintEl.textContent = "Lance une manche depuis le salon pour démarrer l'écran TV.";
      if (overlayTitle) overlayTitle.textContent = "Salon prêt";
      if (overlayCopy) overlayCopy.textContent = "La musique apparaîtra ici.";
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
          : "La solution est affichée pour tout le monde.";
      }
      if (overlayTitle) {
        overlayTitle.textContent = acceptingAnswers ? "Vidéo cachée" : "Solution révélée";
      }
      if (overlayCopy) {
        overlayCopy.textContent = acceptingAnswers ? "Écoute l'extrait." : "Regarde la réponse.";
      }
    }

    this.setVideoConcealed(!revealVisible);
    this.renderSolution(track, revealVisible);
    if (!track?.youtube_video_id) {
      this.stopPlayer();
      this.destroyPreloadPlayer();
      return;
    }
    this.ensurePlayer(track?.youtube_video_id || "", round);
    this.ensureUpcomingPlayer(this.snapshot?.round?.next_track, round);
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

  startTimer() {
    if (this.timerInterval) return;
    this.timerInterval = window.setInterval(() => {
      this.updateTimer();
      this.syncPlayer(this.snapshot?.round?.round);
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
    return (Date.now() - this.serverClockOffsetMs) / 1000;
  }

  getServerNowMs() {
    return Date.now() - this.serverClockOffsetMs;
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

  setVideoConcealed(isConcealed) {
    const shell = document.getElementById("tv-video");
    const overlay = document.getElementById("tv-video-overlay");
    if (shell) shell.classList.toggle("is-concealed", Boolean(isConcealed));
    if (overlay) overlay.hidden = !isConcealed;
  }

  async ensurePlayer(videoId, round) {
    const host = document.getElementById("tv-video-player");
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
        this.player = new YT.Player("tv-video-player", {
          videoId,
          playerVars: {
            autoplay: pendingStart ? 0 : 1,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            mute: 1,
            playsinline: 1,
            rel: 0,
            start: Math.floor(this.getTargetVideoTime(round)),
            origin: window.location.origin,
            vq: YOUTUBE_PREFERRED_QUALITY,
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
              this.requestPlaybackQuality(this.player);
              this.applyAudioState({ allowPlayback: false });
              if (this.isRoundPendingStart(round)) {
                this.primePlayerForPendingStart(round);
              } else {
                this.syncPlayer(round, true);
              }
            },
          },
        });
        return;
      }

      if (!this.playerReady) {
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
          suggestedQuality: YOUTUBE_PREFERRED_QUALITY,
        });
        this.requestPlaybackQuality(this.player);
        this.applyAudioState({ allowPlayback: false });
        if (pendingStart) {
          this.primePlayerForPendingStart(round);
        } else {
          this.syncPlayer(round, true);
        }
        return;
      }

      this.applyAudioState({ allowPlayback: false });
      this.syncPlayer(round);
    } catch {
      this.setStageStatus("Impossible de charger le lecteur YouTube.", false);
    }
  }

  async ensureUpcomingPlayer(track, currentRound) {
    const videoId = String(track?.youtube_video_id || "").trim();
    const currentVideoId = String(currentRound?.track?.youtube_video_id || "").trim();
    if (!videoId || videoId === currentVideoId) {
      this.destroyPreloadPlayer();
      return;
    }

    this.preloadPlayerRequestedVideoId = videoId;
    const startOffset = this.getTrackStartOffsetSeconds(track);

    let host = document.getElementById("tv-video-preload-player");
    if (!host) {
      const shell = document.getElementById("tv-video") || document.body;
      host = document.createElement("div");
      host.id = "tv-video-preload-player";
      host.className = "mq-video-preload-player";
      shell.appendChild(host);
    }

    try {
      const YT = await loadYouTubeIframeApi();
      if (this.preloadPlayerRequestedVideoId !== videoId) return;

      if (!this.preloadPlayer) {
        this.preloadPlayer = new YT.Player("tv-video-preload-player", {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            mute: 1,
            playsinline: 1,
            rel: 0,
            start: Math.floor(startOffset),
            origin: window.location.origin,
            vq: YOUTUBE_PREFERRED_QUALITY,
          },
          events: {
            onReady: () => {
              this.preloadPlayerReady = true;
              if (this.preloadPlayerRequestedVideoId !== videoId) {
                this.preloadPlayerVideoId = "";
                this.ensureUpcomingPlayer(this.snapshot?.round?.next_track, this.snapshot?.round?.round);
                return;
              }
              this.preloadPlayerVideoId = videoId;
              this.cueUpcomingPlayer(startOffset);
            },
          },
        });
        return;
      }

      if (!this.preloadPlayerReady) return;

      if (this.preloadPlayerVideoId === videoId) {
        this.requestPlaybackQuality(this.preloadPlayer);
        return;
      }

      this.preloadPlayerVideoId = videoId;
      this.cueUpcomingPlayer(startOffset);
    } catch {
      // Optional optimization: the main player remains the source of truth.
    }
  }

  cueUpcomingPlayer(startOffset = 0) {
    if (!this.preloadPlayerReady || !this.preloadPlayer) {
      return;
    }

    const safeOffset = Math.floor(Math.max(0, Number(startOffset || 0)));
    try {
      if (typeof this.preloadPlayer.mute === "function") this.preloadPlayer.mute();
      if (typeof this.preloadPlayer.setVolume === "function") this.preloadPlayer.setVolume(0);
      this.requestPlaybackQuality(this.preloadPlayer);
      if (typeof this.preloadPlayer.cueVideoById === "function" && this.preloadPlayerVideoId) {
        this.preloadPlayer.cueVideoById({
          videoId: this.preloadPlayerVideoId,
          startSeconds: safeOffset,
          suggestedQuality: YOUTUBE_PREFERRED_QUALITY,
        });
      } else {
        if (typeof this.preloadPlayer.pauseVideo === "function") this.preloadPlayer.pauseVideo();
        if (typeof this.preloadPlayer.seekTo === "function") this.preloadPlayer.seekTo(safeOffset, false);
      }
    } catch {
      // noop
    }
  }

  stopPlayer() {
    if (this.player && typeof this.player.stopVideo === "function") {
      this.player.stopVideo();
    }
    this.playerVideoId = "";
    this.playerRequestedVideoId = "";
    this.playerLastLoadAtMs = 0;
    this.playerLastPlayAttemptAtMs = 0;
    this.playerPrimingUntilMs = 0;
  }

  primePlayerForPendingStart(round) {
    if (!this.playerReady || !this.player || !this.isRoundPendingStart(round)) {
      return;
    }

    this.playerPrimingUntilMs = Date.now() + 350;
    if (typeof this.player.mute === "function") {
      this.player.mute();
    }
    if (typeof this.player.playVideo === "function") {
      this.player.playVideo();
    }
    window.setTimeout(() => {
      if (this.isRoundPendingStart(round)) {
        this.syncPlayer(round, true);
      }
    }, 380);
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
    const drift = this.computePlaybackDriftSeconds(current, wanted, this.getPlayerDurationSeconds());

    if (
      this.shouldSeekPlayer({ force, drift, state, nowMs })
      && typeof this.player.seekTo === "function"
    ) {
      this.player.seekTo(wanted, true);
      this.playerLastSeekAtMs = nowMs;
    }

    if (pendingStart) {
      if (
        state === window.YT?.PlayerState?.PLAYING
        && nowMs >= this.playerPrimingUntilMs
        && typeof this.player.pauseVideo === "function"
      ) {
        this.player.pauseVideo();
      }
      return;
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

  shouldSeekPlayer({ force, drift, state, nowMs }) {
    if (force) {
      return true;
    }

    if ((nowMs - this.playerLastSeekAtMs) < PLAYER_SYNC_COOLDOWN_MS) {
      return false;
    }

    const isBuffering = this.isPlayerBufferingState(state);
    if (isBuffering && (nowMs - this.playerLastLoadAtMs) < PLAYER_BUFFERING_SEEK_GRACE_MS) {
      return false;
    }

    const threshold = isBuffering ? PLAYER_BUFFERING_HARD_DRIFT_SECONDS : PLAYER_SYNC_DRIFT_SECONDS;
    return drift > threshold;
  }

  isPlayerBufferingState(state) {
    const playerState = window.YT?.PlayerState || {};
    return state === playerState.UNSTARTED
      || state === playerState.BUFFERING
      || state === playerState.CUED;
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

  requestPlaybackQuality(player) {
    if (!player || typeof player.setPlaybackQuality !== "function") {
      return;
    }

    try {
      player.setPlaybackQuality(YOUTUBE_PREFERRED_QUALITY);
    } catch {
      // noop
    }
  }

  destroyPreloadPlayer() {
    if (this.preloadPlayer && typeof this.preloadPlayer.destroy === "function") {
      try {
        if (typeof this.preloadPlayer.stopVideo === "function") this.preloadPlayer.stopVideo();
        this.preloadPlayer.destroy();
      } catch {
        // noop
      }
    }

    this.preloadPlayer = null;
    this.preloadPlayerReady = false;
    this.preloadPlayerVideoId = "";
    this.preloadPlayerRequestedVideoId = "";
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
