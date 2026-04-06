import { buildYouTubeEmbedUrl, extractYouTubeVideoId } from "../utils/youtube.js";

export class ManagementValidationController {
  constructor() {
    this.items = [];
    this.selectedId = null;

    document.getElementById("btn-validation-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-validation-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-validation-approve")?.addEventListener("click", () => this.validateSelected());
    document.getElementById("btn-validation-open-youtube")?.addEventListener("click", () => this.openSelectedTrackOnYouTube());

    this.refresh();
  }

  async refresh() {
    const res = await window.httpClient.listPendingTracks();
    this.setStatus(res.success ? "Musiques en attente chargees" : (res.error || "Erreur"), res.success);
    if (!res.success) return;

    this.items = res.data?.items ?? [];
    this.renderCounters();
    this.renderList();

    const selected = this.items.find((item) => Number(item.id) === Number(this.selectedId)) || this.items[0] || null;
    if (!selected) {
      this.selectedId = null;
      this.renderDetail();
      return;
    }

    this.selectedId = Number(selected.id);
    this.renderList();
    this.renderDetail();
  }

  renderCounters() {
    const count = this.items.length;
    const text = `${count} ${count > 1 ? "musiques en attente" : "musique en attente"}`;
    ["validation-count", "validation-count-inline"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  }

  renderList() {
    const list = document.getElementById("validation-list");
    if (!list) return;

    if (!this.items.length) {
      list.innerHTML = `
        <div class="mq-admin-empty">
          <strong>Aucune musique en attente</strong>
          <p class="mq-muted">Toutes les pistes actuellement en base ont deja ete validees.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.items.map((item) => `
      <button type="button" class="mq-admin-item ${Number(item.id) === Number(this.selectedId) ? "is-selected" : ""}" data-id="${Number(item.id)}">
        <strong>${this.escapeHtml(item.title || "Sans titre")}</strong>
        <div class="mq-admin-item__meta">
          <span class="mq-admin-badge">${this.escapeHtml(item.category_name || "Sans categorie")}</span>
          <span class="mq-admin-badge">${this.escapeHtml(item.family_name || "Sans oeuvre")}</span>
          <span class="mq-admin-badge mq-admin-badge--pending">A valider</span>
          ${item.artist ? `<span class="mq-muted">${this.escapeHtml(item.artist)}</span>` : ""}
          <span class="mq-muted">Ajoutee le ${this.escapeHtml(this.formatDate(item.created_at))}</span>
        </div>
      </button>
    `).join("");

    list.querySelectorAll("[data-id]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedId = Number(button.dataset.id || 0);
        this.renderList();
        this.renderDetail();
      });
    });
  }

  renderDetail() {
    const title = document.getElementById("validation-detail-title");
    const helper = document.getElementById("validation-detail-helper");
    const meta = document.getElementById("validation-detail-meta");
    const frame = document.getElementById("validation-preview-frame");
    const empty = document.getElementById("validation-preview-empty");
    const url = document.getElementById("validation-track-url");
    const created = document.getElementById("validation-track-created");
    const approve = document.getElementById("btn-validation-approve");
    const openYoutube = document.getElementById("btn-validation-open-youtube");

    const item = this.getSelectedItem();
    if (!item) {
      if (title) title.textContent = "Aucune musique selectionnee";
      if (helper) helper.textContent = "Choisis une piste en attente pour verifier son URL YouTube et la valider.";
      if (meta) meta.innerHTML = `<span class="mq-muted">La file d'attente se remplira automatiquement a chaque ajout ou modification de musique.</span>`;
      if (frame) {
        frame.hidden = true;
        frame.removeAttribute("src");
      }
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = `<p class="mq-muted">Aucune preview disponible pour le moment.</p>`;
      }
      if (url) url.textContent = "Aucune URL";
      if (created) created.textContent = "Date d'ajout indisponible";
      if (approve) approve.disabled = true;
      if (openYoutube) openYoutube.disabled = true;
      return;
    }

    const videoId = String(item.youtube_video_id || "").trim() || extractYouTubeVideoId(item.youtube_url);
    const embedUrl = buildYouTubeEmbedUrl(videoId);

    if (title) title.textContent = item.title || "Sans titre";
    if (helper) helper.textContent = "Verifie que la video charge correctement et que la piste correspond bien a l'oeuvre attendue avant de la valider.";
    if (meta) {
      meta.innerHTML = `
        <span class="mq-admin-badge">${this.escapeHtml(item.category_name || "Sans categorie")}</span>
        <span class="mq-admin-badge">${this.escapeHtml(item.family_name || "Sans oeuvre")}</span>
        ${item.artist ? `<span class="mq-muted">${this.escapeHtml(item.artist)}</span>` : `<span class="mq-muted">Artiste non renseigne</span>`}
        ${item.created_by_username ? `<span class="mq-muted">Ajoutee par ${this.escapeHtml(item.created_by_username)}</span>` : ""}
      `;
    }

    if (frame) {
      frame.hidden = !embedUrl;
      if (embedUrl) {
        frame.src = embedUrl;
      } else {
        frame.removeAttribute("src");
      }
    }

    if (empty) {
      empty.hidden = Boolean(embedUrl);
      if (!embedUrl) {
        empty.innerHTML = `<p class="mq-muted">Impossible de generer la preview YouTube. L'URL enregistree doit probablement etre corrigee avant validation.</p>`;
      }
    }

    if (url) {
      url.textContent = item.youtube_url || "Aucune URL";
      url.href = item.youtube_url || "#";
    }

    if (created) {
      created.textContent = `Ajoutee le ${this.formatDate(item.created_at)}`;
    }

    if (approve) approve.disabled = false;
    if (openYoutube) openYoutube.disabled = !item.youtube_url;
  }

  async validateSelected() {
    const item = this.getSelectedItem();
    if (!item) return;

    const res = await window.httpClient.validateTrack(Number(item.id));
    this.setStatus(res.success ? "Musique validee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      await this.refresh();
    }
  }

  openSelectedTrackOnYouTube() {
    const item = this.getSelectedItem();
    if (!item?.youtube_url) return;
    window.open(item.youtube_url, "_blank", "noopener,noreferrer");
  }

  getSelectedItem() {
    return this.items.find((item) => Number(item.id) === Number(this.selectedId)) || null;
  }

  formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return "date inconnue";
    }

    return new Intl.DateTimeFormat("fr-CH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  setStatus(text, ok) {
    const el = document.getElementById("validation-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
