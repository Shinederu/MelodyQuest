function extractYouTubeVideoId(value) {
  const input = String(value || "").trim();
  if (!input) return "";

  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replaceAll("/", "").trim();
    }
    if (url.searchParams.get("v")) {
      return String(url.searchParams.get("v") || "").trim();
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const embedIndex = segments.findIndex((segment) => segment === "embed" || segment === "shorts");
    if (embedIndex >= 0 && segments[embedIndex + 1]) {
      return segments[embedIndex + 1].trim();
    }
  } catch {
    return "";
  }

  return "";
}

export class ManagementTracksController {
  constructor() {
    this.items = [];
    this.categories = [];
    this.families = [];
    this.selectedId = null;
    this.draftCategoryId = null;
    this.draftFamilyName = "";

    document.getElementById("btn-track-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-track-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-track-create")?.addEventListener("click", () => this.create());
    document.getElementById("btn-track-update")?.addEventListener("click", () => this.update());
    document.getElementById("btn-track-delete")?.addEventListener("click", () => this.remove());
    document.getElementById("btn-track-reset")?.addEventListener("click", () => this.resetForm());
    document.getElementById("btn-track-add")?.addEventListener("click", () => this.openCreateForm());
    document.getElementById("track-category")?.addEventListener("change", () => this.handleCategoryChange());
    document.getElementById("track-family-name")?.addEventListener("input", () => this.handleFamilyInput());

    this.refresh();
  }

  async refresh() {
    const [trackRes, famRes, catRes] = await Promise.all([
      window.httpClient.listTracks(),
      window.httpClient.listFamilies(),
      window.httpClient.listCategories(),
    ]);

    this.setStatus(trackRes.success ? "Musiques chargees" : (trackRes.error || "Erreur"), trackRes.success);
    if (!trackRes.success) return;

    this.items = trackRes.data?.items ?? [];
    this.families = famRes.success ? (famRes.data?.items ?? []) : [];
    this.categories = catRes.success ? (catRes.data?.items ?? []) : [];
    this.renderCounters();
    this.renderCategoryOptions();
    this.renderList();

    if (this.selectedId) {
      const selected = this.items.find((item) => Number(item.id) === Number(this.selectedId));
      if (selected) {
        this.fillForm(selected);
        return;
      }
    }

    this.resetForm();
  }

  renderCategoryOptions() {
    const select = document.getElementById("track-category");
    if (!select) return;

    const currentValue = Number(select.value || 0);
    const selectedValue = currentValue > 0
      ? currentValue
      : Number(this.draftCategoryId || 0);

    select.innerHTML = `
      <option value="">Choisir une categorie</option>
      ${this.categories.map((item) => `<option value="${Number(item.id)}">${this.escapeHtml(item.name)}</option>`).join("")}
    `;

    if (selectedValue > 0 && this.categories.some((item) => Number(item.id) === selectedValue)) {
      select.value = String(selectedValue);
    }
  }

  renderFamilySuggestions() {
    const categoryId = this.getSelectedCategoryId();
    const input = document.getElementById("track-family-name");
    const datalist = document.getElementById("track-family-suggestions");
    const hint = document.getElementById("track-family-hint");
    const familyName = String(input?.value || "").trim();
    const families = categoryId > 0
      ? this.families.filter((item) => Number(item.category_id) === categoryId)
      : [];

    if (datalist) {
      datalist.innerHTML = families
        .map((item) => `<option value="${this.escapeAttribute(item.name)}"></option>`)
        .join("");
    }

    if (!hint) return;

    if (categoryId <= 0) {
      hint.textContent = "Selectionne d'abord une categorie pour voir les oeuvres existantes reutilisables.";
      return;
    }

    if (!familyName) {
      hint.textContent = families.length
        ? `${families.length} ${families.length > 1 ? "oeuvres existent" : "oeuvre existe"} deja dans cette categorie.`
        : "Aucune oeuvre enregistree dans cette categorie pour le moment.";
      return;
    }

    const match = families.find((item) => item.name.toLowerCase() === familyName.toLowerCase());
    hint.textContent = match
      ? "Cette oeuvre existe deja dans cette categorie. Elle sera reutilisee."
      : "Cette oeuvre n'existe pas encore dans cette categorie. Elle sera creee automatiquement.";
  }

  renderList() {
    const list = document.getElementById("track-list");
    if (!list) return;

    if (!this.items.length) {
      list.innerHTML = `
        <div class="mq-admin-empty">
          <strong>Aucune musique</strong>
          <p class="mq-muted">Ajoute un premier morceau. L'oeuvre sera creee ou reutilisee directement depuis le formulaire.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.items.map((item) => `
      <button type="button" class="mq-admin-item ${Number(item.id) === Number(this.selectedId) ? "is-selected" : ""}" data-id="${Number(item.id)}">
        <strong>${this.escapeHtml(item.title)}</strong>
        <div class="mq-admin-item__meta">
          <span class="mq-admin-badge">${this.escapeHtml(item.category_name || "Sans categorie")}</span>
          <span class="mq-admin-badge">${this.escapeHtml(item.family_name || "Sans oeuvre")}</span>
          ${item.artist ? `<span class="mq-muted">${this.escapeHtml(item.artist)}</span>` : ""}
        </div>
      </button>
    `).join("");

    list.querySelectorAll("[data-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = this.items.find((item) => Number(item.id) === Number(button.dataset.id));
        if (selected) this.fillForm(selected);
      });
    });
  }

  fillForm(item) {
    this.selectedId = Number(item.id);

    const form = document.getElementById("track-form");
    const category = document.getElementById("track-category");
    const familyName = document.getElementById("track-family-name");
    const title = document.getElementById("track-title");
    const artist = document.getElementById("track-artist");
    const url = document.getElementById("track-youtube-url");

    if (form) form.hidden = false;
    if (category) category.value = String(Number(item.category_id || 0));
    if (familyName) familyName.value = item.family_name || "";
    if (title) title.value = item.title || "";
    if (artist) artist.value = item.artist || "";
    if (url) url.value = item.youtube_url || "";

    this.draftCategoryId = Number(item.category_id || 0) || null;
    this.draftFamilyName = item.family_name || "";
    this.renderFamilySuggestions();
    this.renderList();
    this.updateFormState();
  }

  openCreateForm() {
    if (this.selectedId) {
      this.draftCategoryId = this.getSelectedCategoryId() || this.draftCategoryId;
      this.draftFamilyName = this.getFamilyName();
    }

    this.selectedId = null;
    const form = document.getElementById("track-form");
    if (form) form.hidden = false;
    this.resetForm();
  }

  resetForm() {
    const form = document.getElementById("track-form");
    const category = document.getElementById("track-category");
    const familyName = document.getElementById("track-family-name");
    const title = document.getElementById("track-title");
    const artist = document.getElementById("track-artist");
    const url = document.getElementById("track-youtube-url");

    this.selectedId = null;

    if (form) form.hidden = false;
    if (category) {
      if (this.draftCategoryId && this.categories.some((item) => Number(item.id) === Number(this.draftCategoryId))) {
        category.value = String(Number(this.draftCategoryId));
      } else {
        category.value = "";
      }
    }
    if (familyName) familyName.value = this.draftFamilyName || "";
    if (title) title.value = "";
    if (artist) artist.value = "";
    if (url) url.value = "";

    this.renderFamilySuggestions();
    this.renderList();
    this.updateFormState();
  }

  updateFormState() {
    const title = document.getElementById("track-form-title");
    const helper = document.getElementById("track-form-helper");
    const createBtn = document.getElementById("btn-track-create");
    const updateBtn = document.getElementById("btn-track-update");
    const deleteBtn = document.getElementById("btn-track-delete");
    const resetBtn = document.getElementById("btn-track-reset");

    if (title) title.textContent = this.selectedId ? "Modifier la musique" : "Nouvelle musique";
    if (helper) {
      helper.textContent = this.selectedId
        ? "Mode modification actif. Tu peux changer categorie, oeuvre attendue ou piste sans sortir de cet ecran."
        : "Mode creation actif. La categorie et l'oeuvre sont conservees pour enchainer rapidement plusieurs pistes liees.";
    }
    if (createBtn) createBtn.disabled = !!this.selectedId;
    if (updateBtn) updateBtn.disabled = !this.selectedId;
    if (deleteBtn) deleteBtn.disabled = !this.selectedId;
    if (resetBtn) resetBtn.textContent = this.selectedId ? "Nouvelle musique" : "Vider";
  }

  handleCategoryChange() {
    this.draftCategoryId = this.getSelectedCategoryId() || null;
    this.renderFamilySuggestions();
  }

  handleFamilyInput() {
    this.draftFamilyName = this.getFamilyName();
    this.renderFamilySuggestions();
  }

  async create() {
    const category_id = this.getSelectedCategoryId();
    const family_name = this.getFamilyName();
    const title = String(document.getElementById("track-title")?.value || "").trim();
    const artist = String(document.getElementById("track-artist")?.value || "").trim();
    const youtube_url = String(document.getElementById("track-youtube-url")?.value || "").trim();
    const youtube_video_id = extractYouTubeVideoId(youtube_url);

    const res = await window.httpClient.createTrack({
      category_id,
      family_name,
      title,
      artist,
      youtube_url,
      youtube_video_id,
    });

    this.setStatus(res.success ? "Musique creee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.draftCategoryId = category_id || null;
      this.draftFamilyName = family_name;
      this.selectedId = null;
      await this.refresh();
    }
  }

  async update() {
    if (!this.selectedId) return;

    const category_id = this.getSelectedCategoryId();
    const family_name = this.getFamilyName();
    const title = String(document.getElementById("track-title")?.value || "").trim();
    const artist = String(document.getElementById("track-artist")?.value || "").trim();
    const youtube_url = String(document.getElementById("track-youtube-url")?.value || "").trim();
    const youtube_video_id = extractYouTubeVideoId(youtube_url);

    const res = await window.httpClient.updateTrack({
      id: this.selectedId,
      category_id,
      family_name,
      title,
      artist,
      youtube_url,
      youtube_video_id,
    });

    this.setStatus(res.success ? "Musique mise a jour" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.draftCategoryId = category_id || null;
      this.draftFamilyName = family_name;
      await this.refresh();
    }
  }

  async remove() {
    if (!this.selectedId) return;

    const res = await window.httpClient.deleteTrack(this.selectedId);
    this.setStatus(res.success ? "Musique supprimee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.selectedId = null;
      await this.refresh();
    }
  }

  getSelectedCategoryId() {
    return Number(document.getElementById("track-category")?.value ?? 0);
  }

  getFamilyName() {
    return String(document.getElementById("track-family-name")?.value || "").trim();
  }

  setStatus(text, ok) {
    const el = document.getElementById("track-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }

  renderCounters() {
    const text = `${this.items.length} ${this.items.length > 1 ? "musiques" : "musique"}`;
    ["track-count", "track-count-inline"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  escapeAttribute(value) {
    return this.escapeHtml(value).replaceAll('"', "&quot;");
  }
}
