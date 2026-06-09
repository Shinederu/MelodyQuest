import { getCurrentLobby } from "../utils/LobbyState.js?v=20260609-mobile-ui-v2";

function getRouteParams() {
  const query = String(window.location.hash || "").split("?")[1] || "";
  return new URLSearchParams(query);
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

export class TvLinkController {
  constructor() {
    this.currentLobby = getCurrentLobby();
    this.routeParams = getRouteParams();
    this.returnView = this.routeParams.get("from") === "game" ? "game" : "lobby";
    this.submitButton = document.getElementById("btn-tv-link-submit");
    this.codeInput = document.getElementById("tv-link-code");
    this.scanStream = null;
    this.scanFrameId = 0;
    this.scanInFlight = false;
    this.lastScanAt = 0;
    this.jsQrPromise = null;
    this.jsQr = null;
    this.nativeDetector = null;

    const initialCode = normalizeCode(
      this.routeParams.get("code") || sessionStorage.getItem("mq_pending_tv_code") || ""
    );
    if (this.codeInput) {
      this.codeInput.value = initialCode;
      this.codeInput.addEventListener("input", () => {
        this.codeInput.value = normalizeCode(this.codeInput.value);
      });
      window.setTimeout(() => this.codeInput?.focus(), 80);
    }

    document.getElementById("btn-tv-link-submit")?.addEventListener("click", () => this.linkTv());
    document.getElementById("btn-tv-link-scan")?.addEventListener("click", () => this.openScanner());
    document.getElementById("btn-tv-link-back")?.addEventListener("click", () => this.goBack());
    document.getElementById("btn-tv-link-open-tv")?.addEventListener("click", () => this.openTvMode());
    document.getElementById("btn-tv-scanner-close")?.addEventListener("click", () => this.closeScanner());
    document.querySelector("[data-tv-scanner-close]")?.addEventListener("click", () => this.closeScanner());

    this.renderLobbyContext();
  }

  destroy() {
    this.closeScanner();
  }

  renderLobbyContext() {
    const lobbyLabel = document.getElementById("tv-link-lobby");
    if (!lobbyLabel) return;

    if (!this.currentLobby?.id) {
      lobbyLabel.textContent = "Aucun salon actif";
      this.setStatus("Rejoins ou crée un salon avant de lier une TV.", false);
      this.submitButton?.setAttribute("disabled", "disabled");
      return;
    }

    lobbyLabel.textContent = `${this.currentLobby.name || "Salon"} - ${this.currentLobby.lobby_code || "------"}`;
  }

  async linkTv() {
    const code = normalizeCode(this.codeInput?.value || "");
    const lobbyId = Number(this.currentLobby?.id || 0);
    if (!lobbyId) {
      this.setStatus("Aucun salon actif. Rejoins un salon, puis réessaie.", false);
      return;
    }
    if (code.length !== 6) {
      this.setStatus("Entre le code TV affiché sur l'écran.", false);
      this.codeInput?.focus();
      return;
    }

    this.setBusy(true);
    this.setStatus("Liaison en cours...", null);

    try {
      const response = await window.httpClient.linkTvPairing(code, lobbyId);
      if (!response.success) {
        this.setStatus(response.error || "Impossible de lier cette TV.", false);
        return;
      }

      sessionStorage.removeItem("mq_pending_tv_code");
      this.setStatus("TV liée au salon. L'écran va suivre la partie.", true);
      window.setTimeout(() => this.goBack(), 900);
    } catch {
      this.setStatus("Connexion impossible pendant la liaison TV.", false);
    } finally {
      this.setBusy(false);
    }
  }

  goBack() {
    if (!this.currentLobby?.id) {
      window.appCtrl.changeView("main");
      return;
    }

    window.appCtrl.changeView(this.returnView);
  }

  openTvMode() {
    window.open(`${window.location.origin}/tv`, "_blank", "noopener,noreferrer");
  }

  async openScanner() {
    const modal = document.getElementById("tv-scanner-modal");
    const video = document.getElementById("tv-scanner-video");
    if (!modal || !video) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus("Ton navigateur ne donne pas accès à la caméra. Entre le code manuellement.", false);
      return;
    }

    modal.hidden = false;
    this.setScannerStatus("Ouverture de la caméra...", null);

    try {
      this.scanStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      video.srcObject = this.scanStream;
      video.setAttribute("playsinline", "");
      await video.play();

      await this.prepareQrDecoders();
      this.setScannerStatus("Place le QR code de la TV dans le cadre.", null);
      this.scanFrameId = window.requestAnimationFrame((time) => this.scanFrame(time));
    } catch (error) {
      this.closeScanner(false);
      const permissionDenied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      this.setStatus(
        permissionDenied
          ? "Accès caméra refusé. Tu peux toujours entrer le code TV manuellement."
          : "Impossible d'ouvrir la caméra sur cet appareil.",
        false
      );
    }
  }

  closeScanner(hideModal = true) {
    if (this.scanFrameId) {
      window.cancelAnimationFrame(this.scanFrameId);
      this.scanFrameId = 0;
    }

    if (this.scanStream) {
      this.scanStream.getTracks().forEach((track) => track.stop());
      this.scanStream = null;
    }

    const video = document.getElementById("tv-scanner-video");
    if (video) {
      video.pause();
      video.srcObject = null;
    }

    if (hideModal) {
      const modal = document.getElementById("tv-scanner-modal");
      if (modal) modal.hidden = true;
    }

    this.scanInFlight = false;
  }

  async prepareQrDecoders() {
    if (window.BarcodeDetector && !this.nativeDetector) {
      try {
        const formats = typeof window.BarcodeDetector.getSupportedFormats === "function"
          ? await window.BarcodeDetector.getSupportedFormats()
          : ["qr_code"];
        if (formats.includes("qr_code")) {
          this.nativeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
        }
      } catch {
        this.nativeDetector = null;
      }
    }

    if (!this.nativeDetector) {
      this.jsQr = await this.loadJsQr();
    }
  }

  loadJsQr() {
    if (window.jsQR) {
      return Promise.resolve(window.jsQR);
    }
    if (this.jsQrPromise) {
      return this.jsQrPromise;
    }

    this.jsQrPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/assets/js/vendor/jsqr/jsQR.js?v=1.4.0";
      script.async = true;
      script.onload = () => {
        if (window.jsQR) {
          resolve(window.jsQR);
        } else {
          reject(new Error("jsQR missing"));
        }
      };
      script.onerror = () => reject(new Error("jsQR load failed"));
      document.head.appendChild(script);
    });

    return this.jsQrPromise;
  }

  async scanFrame(timestamp) {
    if (!this.scanStream) return;

    this.scanFrameId = window.requestAnimationFrame((time) => this.scanFrame(time));
    if (this.scanInFlight || timestamp - this.lastScanAt < 180) {
      return;
    }

    this.scanInFlight = true;
    this.lastScanAt = timestamp;

    try {
      const payload = await this.readQrPayload();
      const code = this.extractPairingCode(payload);
      if (code) {
        await this.acceptScannedCode(code);
      }
    } catch {
      // Keep scanning quietly; camera frames often fail until the QR is stable.
    } finally {
      this.scanInFlight = false;
    }
  }

  async readQrPayload() {
    const video = document.getElementById("tv-scanner-video");
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return "";
    }

    if (this.nativeDetector) {
      try {
        const results = await this.nativeDetector.detect(video);
        const value = results?.[0]?.rawValue || "";
        if (value) return value;
      } catch {
        this.nativeDetector = null;
        this.jsQr = await this.loadJsQr();
      }
    }

    const canvas = document.getElementById("tv-scanner-canvas");
    const context = canvas?.getContext?.("2d", { willReadFrequently: true });
    if (!canvas || !context || !this.jsQr) {
      return "";
    }

    const scale = Math.min(1, 760 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = this.jsQr(image.data, image.width, image.height, {
      inversionAttempts: "attemptBoth",
    });

    return result?.data || "";
  }

  extractPairingCode(payload) {
    const raw = String(payload || "").trim();
    if (!raw) return "";

    const direct = normalizeCode(raw);
    if (/^[A-Z0-9]{6}$/.test(raw.toUpperCase()) && direct.length === 6) {
      return direct;
    }

    try {
      const url = new URL(raw, window.location.origin);
      const fromSearch = normalizeCode(url.searchParams.get("code") || "");
      if (fromSearch.length === 6) return fromSearch;

      const hashQuery = String(url.hash || "").split("?")[1] || "";
      const fromHash = normalizeCode(new URLSearchParams(hashQuery).get("code") || "");
      if (fromHash.length === 6) return fromHash;
    } catch {
      // Continue with regex fallback.
    }

    const explicit = raw.match(/[?&#]code=([a-z0-9]{6})/i);
    if (explicit?.[1]) {
      return normalizeCode(explicit[1]);
    }

    return "";
  }

  async acceptScannedCode(code) {
    this.closeScanner();
    if (this.codeInput) {
      this.codeInput.value = code;
    }

    if (!this.currentLobby?.id) {
      this.setStatus("Code TV scanné. Rejoins un salon pour pouvoir le lier.", true);
      return;
    }

    this.setStatus("Code TV scanné. Liaison en cours...", true);
    await this.linkTv();
  }

  setBusy(isBusy) {
    if (!this.submitButton) return;
    this.submitButton.disabled = Boolean(isBusy);
    this.submitButton.textContent = isBusy ? "Liaison..." : "Lier la TV";
  }

  setStatus(message, success = null) {
    const status = document.getElementById("tv-link-status");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("status-success", success === true);
    status.classList.toggle("status-error", success === false);
  }

  setScannerStatus(message, success = null) {
    const status = document.getElementById("tv-scanner-status");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("status-success", success === true);
    status.classList.toggle("status-error", success === false);
  }
}
