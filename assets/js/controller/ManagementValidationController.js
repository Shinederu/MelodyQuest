import { buildYouTubeEmbedUrl, buildYouTubeWatchUrl, extractYouTubeVideoId } from "../utils/youtube.js";

export class ManagementValidationController {
  constructor() {
    this.items = [];
    this.categories = [];
    this.families = [];
    this.selectedId = null;

    document.getElementById("btn-validation-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-validation-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-validation-approve")?.addEventListener("click", () => this.validateSelected());
    document.getElementById("btn-validation-open-youtube")?.addEventListener("click", () => this.openSelectedTrackOnYouTube());
    document.getElementById("validation-category")?.addEventListener("change", () => this.renderFamilyOptions());
    document.getElementById("validation-youtube-url")?.addEventListener("input", () => this.updatePreviewFromForm());
    document.getElementById("validation-track-title")?.addEventListener("input", () => this.updateTitleFromForm());

    this.refresh();
  }

  async refresh() {
    const [pendingRes, catRes, famRes] = await Promise.all([
      window.httpClient.listPendingTracks(),
      window.httpClient.listCategories(),
      window.httpClient.listFamilies(),
    ]);

    if (!pendingRes.success) {
      this.setStatus(pendingRes.error || "Erreur", false);
      return;
    }

    this.items = pendingRes.data?.items ?? [];
    this.categories = catRes.success ? (catRes.data?.items ?? []) : [];
    this.families = famRes.success ? (famRes.data?.items ?? []) : [];
    this.renderCategoryOptions();
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

  renderCategoryOptions() {
    const select = document.getElementById("validation-category");
    if (!select) return;

    const selectedItem = this.getSelectedItem();
    const currentValue = Number(select.value || selectedItem?.category_id || 0);
    select.innerHTML = `
      <option value="">Choisir une categorie</option>
      ${this.categories.map((item) => `<option value="${Number(item.id)}">${this.escapeHtml(item.name)}</option>`).join("")}
    `;

    if (currentValue > 0 && this.categories.some((item) => Number(item.id) === currentValue)) {
      select.value = String(currentValue);
    }

    this.renderFamilyOptions();
  }

  renderFamilyOptions() {
    const list = document.getElementById("validation-family-options");
    if (!list) return;

    const categoryId = this.getFormCategoryId();
    const seen = new Set();
    const options = this.families
      .filter((item) => categoryId <= 0 || Number(item.category_id) === categoryId)
      .map((item) => String(item.name || "").trim())
      .filter((name) => {
        const normalized = this.normalizeSearch(name);
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .sort((left, right) => left.localeCompare(right, "fr", { sensitivity: "base" }))
      .map((name) => `<option value="${this.escapeAttribute(name)}"></option>`)
      .join("");

    list.innerHTML = options;
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
    const created = document.getElementById("validation-track-created");
    const approve = document.getElementById("btn-validation-approve");

    const item = this.getSelectedItem();
    if (!item) {
      if (title) title.textContent = "Aucune musique selectionnee";
      if (helper) helper.textContent = "Choisis une piste en attente pour verifier sa video YouTube et la valider.";
      if (meta) meta.innerHTML = `<span class="mq-muted">Aucune piste n'est selectionnee pour le moment.</span>`;
      if (created) created.textContent = "Date d'ajout indisponible";
      if (approve) approve.disabled = true;
      this.clearForm();
      this.updatePreviewFromForm();
      return;
    }

    this.fillForm(item);

    if (helper) {
      helper.textContent = "Corrige si besoin la categorie, l'oeuvre, le libelle ou l'URL YouTube avant de valider la musique.";
    }
    if (meta) {
      meta.innerHTML = `
        <span class="mq-admin-badge">${this.escapeHtml(item.category_name || "Sans categorie")}</span>
        <span class="mq-admin-badge">${this.escapeHtml(item.family_name || "Sans oeuvre")}</span>
        ${item.created_by_username ? `<span class="mq-muted">Ajoutee par ${this.escapeHtml(item.created_by_username)}</span>` : ""}
      `;
    }
    if (created) {
      created.textContent = `Ajoutee le ${this.formatDate(item.created_at)}`;
    }
    if (approve) approve.disabled = false;

    this.updateTitleFromForm();
    this.updatePreviewFromForm();
  }

  fillForm(item) {
    this.setFormDisabled(false);

    const category = document.getElementById("validation-category");
    const family = document.getElementById("validation-family-name");
    const title = document.getElementById("validation-track-title");
    const artist = document.getElementById("validation-track-artist");
    const youtube = document.getElementById("validation-youtube-url");

    if (category) category.value = String(Number(item.category_id || 0) || "");
    if (family) family.value = item.family_name || "";
    if (title) title.value = item.title || "";
    if (artist) artist.value = item.artist || "";
    if (youtube) youtube.value = item.youtube_url || item.youtube_video_id || "";

    this.renderFamilyOptions();
  }

  clearForm() {
    const category = document.getElementById("validation-category");
    const family = document.getElementById("validation-family-name");
    const title = document.getElementById("validation-track-title");
    const artist = document.getElementById("validation-track-artist");
    const youtube = document.getElementById("validation-youtube-url");

    if (category) category.value = "";
    if (family) family.value = "";
    if (title) title.value = "";
    if (artist) artist.value = "";
    if (youtube) youtube.value = "";

    this.renderFamilyOptions();
    this.setFormDisabled(true);
  }

  setFormDisabled(disabled) {
    [
      "validation-category",
      "validation-family-name",
      "validation-track-title",
      "validation-track-artist",
      "validation-youtube-url",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  updateTitleFromForm() {
    const title = document.getElementById("validation-detail-title");
    if (!title) return;

    const value = String(document.getElementById("validation-track-title")?.value || "").trim();
    title.textContent = value || "Sans titre";
  }

  updatePreviewFromForm() {
    const frame = document.getElementById("validation-preview-frame");
    const empty = document.getElementById("validation-preview-empty");
    const url = document.getElementById("validation-track-url");
    const openYoutube = document.getElementById("btn-validation-open-youtube");
    const videoId = extractYouTubeVideoId(this.getYoutubeInput());
    const embedUrl = buildYouTubeEmbedUrl(videoId);
    const youtubeUrl = buildYouTubeWatchUrl(videoId);

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
        empty.innerHTML = `<p class="mq-muted">Impossible de generer la preview YouTube. Corrige l'ID ou l'URL avant validation.</p>`;
      }
    }

    if (url) {
      url.textContent = youtubeUrl || "Aucun lien";
      url.href = youtubeUrl || "#";
    }

    if (openYoutube) {
      openYoutube.disabled = !youtubeUrl || !this.getSelectedItem();
    }
  }

  async validateSelected() {
    const item = this.getSelectedItem();
    if (!item) return;

    const payload = this.getValidationPayload(item);
    if (!payload) return;

    const res = await window.httpClient.validateTrack(payload);
    this.setStatus(res.success ? "Musique validee avec corrections appliquees" : (res.error || "Erreur"), res.success);
    if (res.success) {
      await this.refresh();
    }
  }

  getValidationPayload(item) {
    const categoryId = this.getFormCategoryId();
    const familyName = String(document.getElementById("validation-family-name")?.value || "").trim();
    const title = String(document.getElementById("validation-track-title")?.value || "").trim();
    const artist = String(document.getElementById("validation-track-artist")?.value || "").trim();
    const youtubeVideoId = extractYouTubeVideoId(this.getYoutubeInput());

    if (categoryId <= 0) {
      this.setStatus("Categorie requise avant validation", false);
      return null;
    }
    if (!familyName) {
      this.setStatus("Oeuvre requise avant validation", false);
      return null;
    }
    if (!title) {
      this.setStatus("Libelle de piste requis avant validation", false);
      return null;
    }
    if (!youtubeVideoId) {
      this.setStatus("ID ou URL YouTube invalide", false);
      return null;
    }

    return {
      track_id: Number(item.id),
      category_id: categoryId,
      family_name: familyName,
      title,
      artist,
      youtube_video_id: youtubeVideoId,
    };
  }

  openSelectedTrackOnYouTube() {
    const youtubeUrl = buildYouTubeWatchUrl(extractYouTubeVideoId(this.getYoutubeInput()));
    if (!youtubeUrl) return;
    window.open(youtubeUrl, "_blank", "noopener,noreferrer");
  }

  getFormCategoryId() {
    return Number(document.getElementById("validation-category")?.value || 0);
  }

  getYoutubeInput() {
    return String(document.getElementById("validation-youtube-url")?.value || "").trim();
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

  normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
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

  escapeAttribute(value) {
    return this.escapeHtml(value).replaceAll('"', "&quot;");
  }
}
