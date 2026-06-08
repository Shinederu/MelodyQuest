export class SuggestTrackController {
  constructor() {
    document.getElementById("btn-suggest-track-back")?.addEventListener("click", () => {
      const user = JSON.parse(localStorage.getItem("user") || "null");
      window.appCtrl.changeView(user ? "main" : "public");
    });
    document.getElementById("suggest-track-form")?.addEventListener("submit", () => this.submit());
  }

  async submit() {
    const payload = {
      suggestion_type: "new_track",
      proposed_title: this.value("suggest-track-title"),
      proposed_artist: this.value("suggest-track-artist"),
      proposed_youtube_url: this.value("suggest-track-url"),
      proposed_alias: this.value("suggest-track-alias"),
      note: this.value("suggest-track-note"),
    };

    if (!payload.proposed_title && !payload.proposed_youtube_url) {
      this.setStatus("Indique au moins un libellé ou une URL YouTube.", false);
      return;
    }

    this.setStatus("Envoi de la proposition...", null);
    const res = await window.httpClient.submitSuggestion(payload);
    if (!res.success) {
      this.setStatus(res.error || "Erreur pendant l'envoi.", false);
      return;
    }

    this.clearForm();
    this.setStatus("Proposition envoyée. Merci !", true);
  }

  clearForm() {
    [
      "suggest-track-title",
      "suggest-track-artist",
      "suggest-track-url",
      "suggest-track-alias",
      "suggest-track-note",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  }

  value(id) {
    return String(document.getElementById(id)?.value || "").trim();
  }

  setStatus(text, ok = null) {
    const el = document.getElementById("suggest-track-status");
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
}
