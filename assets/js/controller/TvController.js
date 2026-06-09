import { renderQrSvg } from "../utils/qr.js?v=20260609-tv-mode";

const TV_TOKEN_STORAGE_KEY = "mq_tv_device_token";
const TV_POLL_INTERVAL_MS = 1500;
const TV_TIMER_INTERVAL_MS = 250;
const TV_PLAYER_VOLUME_KEY = "mq_tv_volume";
const TV_SOUND_ENABLED_KEY = "mq_tv_sound_enabled";
const PLAYER_SYNC_DRIFT_SECONDS = 1.35;

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
    if (existing) return;

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
    this.playerVolume = this.loadVolume();
    this.soundEnabled = localStorage.getItem(TV_SOUND_ENABLED_KEY) === "1";

    document.getElementById("btn-tv-new-pairing")?.addEventListener("click", () => this.resetPairing());
    document.getElementById("btn-tv-stage-new-pairing")?.addEventListener("click", () => this.resetPairing());
    document.getElementById("btn-tv-activate-audio")?.addEventListener("click", () => this.activateAudio());
    document.getElementById("tv-volume")?.addEventListener("input", (event) => this.handleVolumeInput(event));

    this.updateVolumeUi();
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
    this.pairingPollInterval = window.setInterval(() => this.pollPairing(), TV_POLL_INTERVAL_MS);
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
    this.statePollInterval = window.setInterval(() => this.refreshState(), TV_POLL_INTERVAL_MS);
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
        this.setStageStatus(response.error || "Impossible de synchroniser le salon.", false);
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
    const revealVisible = Boolean(round?.is_reveal_visible);
    const acceptingAnswers = Boolean(round?.is_accepting_answers);
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
      this.setVideoConcealed(true);
      this.renderSolution(null, false);
      if (phaseEl) phaseEl.textContent = "En attente";
      if (hintEl) hintEl.textContent = "Lance une manche depuis le salon pour démarrer l'écran TV.";
      if (overlayTitle) overlayTitle.textContent = "Salon prêt";
      if (overlayCopy) overlayCopy.textContent = "La musique apparaîtra ici.";
      return;
    }

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

    this.setVideoConcealed(!revealVisible);
    this.renderSolution(track, revealVisible);
    if (!track?.youtube_video_id) {
      this.stopPlayer();
      return;
    }
    this.ensurePlayer(track?.youtube_video_id || "", round);
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
    this.timerInterval = window.setInterval(() => this.updateTimer(), TV_TIMER_INTERVAL_MS);
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

    const now = this.getServerNowUnix();
    if (round.is_accepting_answers) {
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

  setVideoConcealed(isConcealed) {
    const shell = document.getElementById("tv-video");
    const overlay = document.getElementById("tv-video-overlay");
    if (shell) shell.classList.toggle("is-concealed", Boolean(isConcealed));
    if (overlay) overlay.hidden = !isConcealed;
  }

  async ensurePlayer(videoId, round) {
    const host = document.getElementById("tv-video-player");
    if (!host || !videoId || !round?.id) return;

    this.playerRequestedVideoId = videoId;
    try {
      const YT = await loadYouTubeIframeApi();
      if (this.playerRequestedVideoId !== videoId) return;

      if (!this.player) {
        this.player = new YT.Player("tv-video-player", {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            start: Math.floor(this.getTargetVideoTime(round)),
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              this.playerReady = true;
              this.playerVideoId = videoId;
              this.applyAudioState();
              this.syncPlayer(round);
            },
          },
        });
        return;
      }

      if (this.playerVideoId !== videoId && typeof this.player.loadVideoById === "function") {
        this.playerVideoId = videoId;
        this.player.loadVideoById({
          videoId,
          startSeconds: Math.floor(this.getTargetVideoTime(round)),
        });
        this.applyAudioState();
        return;
      }

      this.syncPlayer(round);
    } catch {
      this.setStageStatus("Impossible de charger le lecteur YouTube.", false);
    }
  }

  stopPlayer() {
    if (this.player && typeof this.player.stopVideo === "function") {
      this.player.stopVideo();
    }
    this.playerVideoId = "";
    this.playerRequestedVideoId = "";
  }

  syncPlayer(round) {
    if (!this.playerReady || !this.player || !round?.id || typeof this.player.getCurrentTime !== "function") {
      return;
    }

    const wanted = this.getTargetVideoTime(round);
    const current = Number(this.player.getCurrentTime() || 0);
    if (Math.abs(current - wanted) > PLAYER_SYNC_DRIFT_SECONDS && typeof this.player.seekTo === "function") {
      this.player.seekTo(wanted, true);
    }

    if (typeof this.player.playVideo === "function") {
      this.player.playVideo();
    }
  }

  getTargetVideoTime(round) {
    const track = round?.track || {};
    const startOffset = Math.max(0, Number(track.start_offset_seconds || 0));
    const startedAt = Number(round?.started_at_unix || 0);
    if (!startedAt) return startOffset;

    return Math.max(0, startOffset + (this.getServerNowUnix() - startedAt));
  }

  activateAudio() {
    this.soundEnabled = true;
    localStorage.setItem(TV_SOUND_ENABLED_KEY, "1");
    this.applyAudioState();
    this.setStageStatus("Son activé sur cette TV.", true);
  }

  applyAudioState() {
    if (!this.player) return;

    if (typeof this.player.setVolume === "function") {
      this.player.setVolume(this.playerVolume);
    }
    if (this.soundEnabled) {
      if (typeof this.player.unMute === "function") this.player.unMute();
      if (typeof this.player.playVideo === "function") this.player.playVideo();
    } else if (typeof this.player.mute === "function") {
      this.player.mute();
    }

    const button = document.getElementById("btn-tv-activate-audio");
    if (button) {
      button.textContent = this.soundEnabled ? "Son activé" : "Activer le son";
      button.disabled = this.soundEnabled;
    }
  }

  handleVolumeInput(event) {
    const value = Math.max(0, Math.min(100, Number(event?.target?.value || this.playerVolume)));
    this.playerVolume = value;
    localStorage.setItem(TV_PLAYER_VOLUME_KEY, String(value));
    this.updateVolumeUi();
    if (typeof this.player?.setVolume === "function") {
      this.player.setVolume(value);
    }
  }

  loadVolume() {
    const stored = Number(localStorage.getItem(TV_PLAYER_VOLUME_KEY));
    return Number.isFinite(stored) ? Math.max(0, Math.min(100, stored)) : 75;
  }

  updateVolumeUi() {
    const input = document.getElementById("tv-volume");
    const label = document.getElementById("tv-volume-value");
    if (input) input.value = String(this.playerVolume);
    if (label) label.textContent = `${this.playerVolume}%`;
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
    const url = String(player?.avatar_url || "").trim();
    const name = String(player?.username || "Joueur").trim();
    if (url) {
      return `<img class="mq-avatar" src="${this.escapeHtml(url)}" alt="">`;
    }

    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "?";

    return `<span class="mq-avatar mq-avatar--fallback">${this.escapeHtml(initials)}</span>`;
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
