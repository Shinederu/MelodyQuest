import { extractYouTubeVideoId } from "../utils/youtube.js";

export class ManagementTracksController {
  constructor() {
    this.items = [];
    this.categories = [];
    this.families = [];
    this.selectedId = null;
    this.draftCategoryId = null;
    this.draftFamilyName = "";
    this.familySuggestions = [];
    this.activeFamilySuggestionIndex = -1;
    this.isFamilySuggestionOpen = false;

    document.getElementById("btn-track-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-track-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-track-create")?.addEventListener("click", () => this.create());
    document.getElementById("btn-track-update")?.addEventListener("click", () => this.update());
    document.getElementById("btn-track-unvalidate")?.addEventListener("click", () => this.unvalidate());
    document.getElementById("btn-track-delete")?.addEventListener("click", () => this.remove());
    document.getElementById("btn-track-reset")?.addEventListener("click", () => this.resetForm());
    document.getElementById("btn-track-add")?.addEventListener("click", () => this.openCreateForm());
    document.getElementById("track-category")?.addEventListener("change", () => this.handleCategoryChange());
    document.getElementById("track-family-name")?.addEventListener("input", () => this.handleFamilyInput());
    document.getElementById("track-family-name")?.addEventListener("focus", () => this.openFamilySuggestions());
    document.getElementById("track-family-name")?.addEventListener("keydown", (event) => this.handleFamilyKeydown(event));
    document.getElementById("track-family-name")?.addEventListener("blur", () => this.handleFamilyBlur());

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
    const panel = document.getElementById("track-family-suggestions");
    const hint = document.getElementById("track-family-hint");
    const familyName = String(input?.value || "").trim();
    const query = this.normalizeSearch(familyName);
    const families = this.getFamilyNamesForCategory(categoryId);
    const exactMatch = query
      ? families.find((item) => this.normalizeSearch(item) === query)
      : null;

    this.familySuggestions = categoryId > 0
      ? this.buildFamilySuggestions(families, query)
      : [];

    if (!this.familySuggestions.length) {
      this.activeFamilySuggestionIndex = -1;
    } else if (this.activeFamilySuggestionIndex >= this.familySuggestions.length) {
      this.activeFamilySuggestionIndex = this.familySuggestions.length - 1;
    }

    const showEmptyState = this.isFamilySuggestionOpen && categoryId > 0 && query && !this.familySuggestions.length;
    const showPanel = this.isFamilySuggestionOpen && categoryId > 0 && (this.familySuggestions.length > 0 || showEmptyState);

    if (panel) {
      panel.hidden = !showPanel;
      panel.innerHTML = this.familySuggestions.length
        ? this.familySuggestions.map((item, index) => `
            <button
              type="button"
              class="mq-autocomplete__option ${index === this.activeFamilySuggestionIndex ? "is-active" : ""}"
              data-family-name="${this.escapeAttribute(item.name)}"
              data-family-index="${index}"
            >
              <span class="mq-autocomplete__option-main">${this.escapeHtml(item.name)}</span>
              <span class="mq-autocomplete__option-meta">
                ${item.startsWithQuery ? "Commence par la saisie" : "Contient la saisie"}
              </span>
            </button>
          `).join("")
        : `
            <div class="mq-autocomplete__empty">
              Aucune oeuvre existante ne correspond. La saisie sera creee automatiquement.
            </div>
          `;

      panel.querySelectorAll("[data-family-name]").forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          this.selectFamilySuggestion(String(button.getAttribute("data-family-name") || ""));
        });
      });

      if (showPanel && this.activeFamilySuggestionIndex >= 0) {
        panel.querySelector(`[data-family-index="${this.activeFamilySuggestionIndex}"]`)?.scrollIntoView({ block: "nearest" });
      }
    }

    if (input) {
      input.setAttribute("aria-expanded", String(showPanel));
    }

    if (!hint) return;

    if (categoryId <= 0) {
      hint.textContent = "Selectionne d'abord une categorie pour voir les oeuvres existantes reutilisables.";
      return;
    }

    if (!familyName) {
      hint.textContent = families.length
        ? `${families.length} ${families.length > 1 ? "oeuvres existent" : "oeuvre existe"} deja dans cette categorie. Commence a taper pour filtrer.`
        : "Aucune oeuvre enregistree dans cette categorie pour le moment.";
      return;
    }

    if (exactMatch) {
      hint.textContent = "Cette oeuvre existe deja dans cette categorie. Elle sera reutilisee.";
      return;
    }

    if (this.familySuggestions.length) {
      hint.textContent = `${this.familySuggestions.length} ${this.familySuggestions.length > 1 ? "propositions correspondent" : "proposition correspond"} a ta saisie. Tu peux en selectionner une ci-dessous.`;
      return;
    }

    hint.textContent = families.length
      ? "Aucune oeuvre existante ne correspond. La saisie sera creee automatiquement."
      : "Aucune oeuvre enregistree dans cette categorie pour le moment.";
  }

  buildFamilySuggestions(families, query) {
    const baseItems = families.map((name) => {
      const normalizedName = this.normalizeSearch(name);
      return {
        name,
        normalizedName,
        position: query ? normalizedName.indexOf(query) : 0,
        startsWithQuery: query ? normalizedName.startsWith(query) : false,
      };
    });

    const filtered = query
      ? baseItems.filter((item) => item.position >= 0)
      : baseItems;

    return filtered
      .sort((left, right) =>
        Number(left.startsWithQuery) === Number(right.startsWithQuery)
          ? left.position - right.position || left.name.localeCompare(right.name, "fr", { sensitivity: "base" })
          : Number(right.startsWithQuery) - Number(left.startsWithQuery)
      )
      .slice(0, 8);
  }

  getFamilyNamesForCategory(categoryId) {
    if (categoryId <= 0) return [];

    const seen = new Set();

    return this.families
      .filter((item) => Number(item.category_id) === Number(categoryId))
      .map((item) => String(item.name || "").trim())
      .filter((name) => {
        const normalizedName = this.normalizeSearch(name);
        if (!normalizedName || seen.has(normalizedName)) return false;
        seen.add(normalizedName);
        return true;
      })
      .sort((left, right) => left.localeCompare(right, "fr", { sensitivity: "base" }));
  }

  openFamilySuggestions() {
    this.isFamilySuggestionOpen = true;
    this.renderFamilySuggestions();
  }

  closeFamilySuggestions() {
    this.isFamilySuggestionOpen = false;
    this.activeFamilySuggestionIndex = -1;
    this.renderFamilySuggestions();
  }

  handleFamilyKeydown(event) {
    if (!event) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!this.isFamilySuggestionOpen) {
        this.isFamilySuggestionOpen = true;
        this.renderFamilySuggestions();
      }
      if (!this.familySuggestions.length) return;

      this.activeFamilySuggestionIndex = this.activeFamilySuggestionIndex < 0
        ? 0
        : (this.activeFamilySuggestionIndex + 1) % this.familySuggestions.length;
      this.renderFamilySuggestions();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!this.isFamilySuggestionOpen) {
        this.isFamilySuggestionOpen = true;
        this.renderFamilySuggestions();
      }
      if (!this.familySuggestions.length) return;

      this.activeFamilySuggestionIndex = this.activeFamilySuggestionIndex < 0
        ? this.familySuggestions.length - 1
        : (this.activeFamilySuggestionIndex - 1 + this.familySuggestions.length) % this.familySuggestions.length;
      this.renderFamilySuggestions();
      return;
    }

    if (event.key === "Enter" && this.isFamilySuggestionOpen && this.activeFamilySuggestionIndex >= 0) {
      event.preventDefault();
      this.selectFamilySuggestion(this.familySuggestions[this.activeFamilySuggestionIndex]?.name || "");
      return;
    }

    if (event.key === "Escape" && this.isFamilySuggestionOpen) {
      event.preventDefault();
      this.closeFamilySuggestions();
    }
  }

  handleFamilyBlur() {
    window.setTimeout(() => {
      const activeElement = document.activeElement;
      const panel = document.getElementById("track-family-suggestions");
      if (panel && activeElement && panel.contains(activeElement)) {
        return;
      }
      this.closeFamilySuggestions();
    }, 120);
  }

  selectFamilySuggestion(name) {
    const input = document.getElementById("track-family-name");
    const selectedName = String(name || "").trim();

    if (input) {
      input.value = selectedName;
      input.focus();
    }

    this.draftFamilyName = selectedName;
    this.activeFamilySuggestionIndex = -1;
    this.isFamilySuggestionOpen = false;
    this.renderFamilySuggestions();
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
          <span class="mq-admin-badge ${Number(item.is_validated) === 1 ? "mq-admin-badge--success" : "mq-admin-badge--pending"}">
            ${Number(item.is_validated) === 1 ? "Validee" : "En attente"}
          </span>
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
    this.isFamilySuggestionOpen = false;
    this.activeFamilySuggestionIndex = -1;
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

    this.isFamilySuggestionOpen = false;
    this.activeFamilySuggestionIndex = -1;
    this.renderFamilySuggestions();
    this.renderList();
    this.updateFormState();
  }

  updateFormState() {
    const title = document.getElementById("track-form-title");
    const helper = document.getElementById("track-form-helper");
    const createBtn = document.getElementById("btn-track-create");
    const updateBtn = document.getElementById("btn-track-update");
    const unvalidateBtn = document.getElementById("btn-track-unvalidate");
    const deleteBtn = document.getElementById("btn-track-delete");
    const resetBtn = document.getElementById("btn-track-reset");
    const selectedItem = this.items.find((item) => Number(item.id) === Number(this.selectedId));
    const isValidated = Number(selectedItem?.is_validated || 0) === 1;

    if (title) title.textContent = this.selectedId ? "Modifier la musique" : "Nouvelle musique";
    if (helper) {
      helper.textContent = this.selectedId
        ? "Mode modification actif. Toute mise a jour repasse la piste en attente, et tu peux aussi la rebasculer manuellement si besoin."
        : "Mode creation actif. Les nouvelles musiques sont ajoutees en attente de validation, avec categorie et oeuvre conservees pour enchainer rapidement.";
    }
    if (createBtn) createBtn.disabled = !!this.selectedId;
    if (updateBtn) updateBtn.disabled = !this.selectedId;
    if (unvalidateBtn) unvalidateBtn.disabled = !this.selectedId || !isValidated;
    if (deleteBtn) deleteBtn.disabled = !this.selectedId;
    if (resetBtn) resetBtn.textContent = this.selectedId ? "Nouvelle musique" : "Vider";
  }

  handleCategoryChange() {
    this.draftCategoryId = this.getSelectedCategoryId() || null;
    this.activeFamilySuggestionIndex = -1;
    this.isFamilySuggestionOpen = document.activeElement === document.getElementById("track-family-name");
    this.renderFamilySuggestions();
  }

  handleFamilyInput() {
    this.draftFamilyName = this.getFamilyName();
    this.activeFamilySuggestionIndex = -1;
    this.isFamilySuggestionOpen = true;
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

    this.setStatus(res.success ? "Musique creee en attente de validation" : (res.error || "Erreur"), res.success);
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

    this.setStatus(res.success ? "Musique mise a jour et repassee en attente de validation" : (res.error || "Erreur"), res.success);
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

  async unvalidate() {
    if (!this.selectedId) return;

    const res = await window.httpClient.unvalidateTrack(this.selectedId);
    this.setStatus(res.success ? "Musique repassee en attente de validation" : (res.error || "Erreur"), res.success);
    if (res.success) {
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

  normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
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
