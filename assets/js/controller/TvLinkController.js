import { getCurrentLobby } from "../utils/LobbyState.js?v=20260609-tv-mode";

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
    document.getElementById("btn-tv-link-back")?.addEventListener("click", () => this.goBack());
    document.getElementById("btn-tv-link-open-tv")?.addEventListener("click", () => this.openTvMode());

    this.renderLobbyContext();
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
}
