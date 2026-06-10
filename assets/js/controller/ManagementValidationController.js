import { buildYouTubeEmbedUrl, buildYouTubeWatchUrl, extractYouTubeVideoId } from "../utils/youtube.js?v=20260610-shared-utils";
import { escapeAttribute, escapeHtml, formatDate, normalizeSearch } from "../utils/ui.js?v=20260610-shared-utils";

export class ManagementValidationController {
  constructor() {
    this.items = [];
    this.categories = [];
    this.families = [];
    this.selectedId = null;
    this.aliases = [];
    this.aliasesAvailable = false;
    this.aliasDirty = false;

    document.getElementById("btn-validation-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-validation-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-validation-approve")?.addEventListener("click", () => this.validateSelected());
    document.getElementById("btn-validation-reject")?.addEventListener("click", () => this.rejectSelected());
    document.getElementById("btn-validation-open-youtube")?.addEventListener("click", () => this.openSelectedTrackOnYouTube());
    document.getElementById("btn-validation-add-alias")?.addEventListener("click", () => this.addAliasFromInput());
    document.getElementById("validation-category")?.addEventListener("change", () => {
      this.renderFamilyOptions();
      this.syncAliasesFromSelectedFamily();
    });
    document.getElementById("validation-family-name")?.addEventListener("input", () => this.syncAliasesFromSelectedFamily());
    document.getElementById("validation-family-name")?.addEventListener("change", () => this.syncAliasesFromSelectedFamily());
    document.getElementById("validation-alias-input")?.addEventListener("keydown", (event) => this.handleAliasInputKeydown(event));
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
    this.aliasesAvailable = famRes.success;
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
      <option value="">Choisir une catégorie</option>
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
          <p class="mq-muted">Toutes les pistes actuellement en base ont déjà été validées.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.items.map((item) => `
      <button type="button" class="mq-admin-item ${Number(item.id) === Number(this.selectedId) ? "is-selected" : ""}" data-id="${Number(item.id)}">
        <strong>${this.escapeHtml(item.title || "Sans titre")}</strong>
        <div class="mq-admin-item__meta">
          <span class="mq-admin-badge">${this.escapeHtml(item.category_name || "Sans catégorie")}</span>
          <span class="mq-admin-badge">${this.escapeHtml(item.family_name || "Sans œuvre")}</span>
          <span class="mq-admin-badge mq-admin-badge--pending">À valider</span>
          ${item.artist ? `<span class="mq-muted">${this.escapeHtml(item.artist)}</span>` : ""}
          <span class="mq-muted">Ajoutée le ${this.escapeHtml(this.formatDate(item.created_at))}</span>
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
    const reject = document.getElementById("btn-validation-reject");

    const item = this.getSelectedItem();
    if (!item) {
      if (title) title.textContent = "Aucune musique sélectionnée";
      if (helper) helper.textContent = "Choisis une piste en attente pour vérifier sa vidéo YouTube et la valider.";
      if (meta) meta.innerHTML = `<span class="mq-muted">Aucune piste n'est sélectionnée pour le moment.</span>`;
      if (created) created.textContent = "Date d'ajout indisponible";
      if (approve) approve.disabled = true;
      if (reject) reject.disabled = true;
      this.clearForm();
      this.updatePreviewFromForm();
      return;
    }

    this.fillForm(item);

    if (helper) {
      helper.textContent = "Corrige si besoin la catégorie, l'œuvre, les alias, le libellé ou l'URL YouTube avant de valider la musique.";
    }
    if (meta) {
      meta.innerHTML = `
        <span class="mq-admin-badge">${this.escapeHtml(item.category_name || "Sans catégorie")}</span>
        <span class="mq-admin-badge">${this.escapeHtml(item.family_name || "Sans œuvre")}</span>
        ${item.created_by_username ? `<span class="mq-muted">Ajoutée par ${this.escapeHtml(item.created_by_username)}</span>` : ""}
      `;
    }
    if (created) {
      created.textContent = `Ajoutée le ${this.formatDate(item.created_at)}`;
    }
    if (approve) approve.disabled = false;
    if (reject) reject.disabled = false;

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

    this.aliasDirty = false;
    this.setAliases(this.getAliasesForTrack(item), { markDirty: false });
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

    this.aliasDirty = false;
    this.setAliases([], { markDirty: false });
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

    const aliasDisabled = disabled || !this.aliasesAvailable;
    ["validation-alias-input", "btn-validation-add-alias"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = aliasDisabled;
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
        empty.innerHTML = `<p class="mq-muted">Impossible de générer la preview YouTube. Corrige l'ID ou l'URL avant validation.</p>`;
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
    this.setStatus(res.success ? "Musique validée avec corrections appliquées" : (res.error || "Erreur"), res.success);
    if (res.success) {
      await this.refresh();
    }
  }

  async rejectSelected() {
    const item = this.getSelectedItem();
    if (!item) return;

    const title = String(item.title || "cette musique").trim();
    const confirmed = window.confirm(`Refuser et supprimer "${title}" de la file de validation ?`);
    if (!confirmed) return;

    const res = await window.httpClient.deleteTrack(Number(item.id));
    this.setStatus(res.success ? "Musique refusée et supprimée" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.selectedId = null;
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
      this.setStatus("Catégorie requise avant validation", false);
      return null;
    }
    if (!familyName) {
      this.setStatus("Œuvre requise avant validation", false);
      return null;
    }
    if (!title) {
      this.setStatus("Libellé de piste requis avant validation", false);
      return null;
    }
    if (!youtubeVideoId) {
      this.setStatus("ID ou URL YouTube invalide", false);
      return null;
    }

    const payload = {
      track_id: Number(item.id),
      category_id: categoryId,
      family_name: familyName,
      title,
      artist,
      youtube_video_id: youtubeVideoId,
    };

    if (this.aliasesAvailable) {
      payload.aliases = [...this.aliases];
    }

    return payload;
  }

  handleAliasInputKeydown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    this.addAliasFromInput();
  }

  addAliasFromInput() {
    const input = document.getElementById("validation-alias-input");
    if (!input || input.disabled) return;

    const value = String(input.value || "").trim();
    if (!value) return;

    const nextAliases = [...this.aliases];
    this.parseAliases(value).forEach((alias) => {
      if (this.hasAlias(nextAliases, alias)) return;
      nextAliases.push(alias);
    });

    input.value = "";
    this.setAliases(nextAliases, { markDirty: true });
  }

  setAliases(values, options = {}) {
    this.aliases = this.parseAliases(Array.isArray(values) ? values.join("\n") : values);
    if (options.markDirty) {
      this.aliasDirty = true;
    }
    this.renderAliasList();
  }

  renderAliasList() {
    const list = document.getElementById("validation-alias-list");
    if (!list) return;

    if (!this.aliasesAvailable) {
      list.innerHTML = `
        <div class="mq-alias-empty">
          <span>Alias indisponibles pour le moment.</span>
        </div>
      `;
      return;
    }

    if (!this.aliases.length) {
      list.innerHTML = `
        <div class="mq-alias-empty">
          <span>Aucun alias ajouté pour le moment.</span>
        </div>
      `;
      return;
    }

    list.innerHTML = this.aliases.map((alias, index) => `
      <div class="mq-alias-item">
        <span>${this.escapeHtml(alias)}</span>
        <button type="button" class="mq-danger mq-alias-item__remove" data-alias-index="${index}" aria-label="Supprimer l'alias ${this.escapeHtml(alias)}">X</button>
      </div>
    `).join("");

    list.querySelectorAll("[data-alias-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const aliasIndex = Number(button.dataset.aliasIndex);
        this.aliases = this.aliases.filter((_, index) => index !== aliasIndex);
        this.aliasDirty = true;
        this.renderAliasList();
      });
    });
  }

  syncAliasesFromSelectedFamily() {
    if (this.aliasDirty || !this.aliasesAvailable) return;

    const family = this.findMatchingFamily(
      this.getFormCategoryId(),
      document.getElementById("validation-family-name")?.value || "",
    );
    this.setAliases(family?.aliases || [], { markDirty: false });
  }

  getAliasesForTrack(item) {
    const family = this.findFamilyById(item.family_id)
      || this.findMatchingFamily(item.category_id, item.family_name);
    return family?.aliases || [];
  }

  findFamilyById(familyId) {
    const id = Number(familyId || 0);
    if (id <= 0) return null;
    return this.families.find((family) => Number(family.id) === id) || null;
  }

  findMatchingFamily(categoryId, familyName) {
    const normalizedName = this.normalizeSearch(familyName);
    const normalizedCategoryId = Number(categoryId || 0);
    if (!normalizedName || normalizedCategoryId <= 0) return null;

    return this.families.find((family) => {
      return Number(family.category_id) === normalizedCategoryId
        && this.normalizeSearch(family.name) === normalizedName;
    }) || null;
  }

  parseAliases(rawValue) {
    const seen = new Set();
    const values = String(rawValue || "")
      .split(/\r?\n|,|;/)
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return values.filter((value) => {
      const key = this.normalizeAlias(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  hasAlias(aliases, value) {
    const key = this.normalizeAlias(value);
    return aliases.some((alias) => this.normalizeAlias(alias) === key);
  }

  normalizeAlias(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
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
    return formatDate(value);
  }

  normalizeSearch(value) {
    return normalizeSearch(value);
  }

  setStatus(text, ok) {
    const el = document.getElementById("validation-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }

  escapeHtml(value) {
    return escapeHtml(value);
  }

  escapeAttribute(value) {
    return escapeAttribute(value);
  }
}
