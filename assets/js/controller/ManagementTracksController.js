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
    this.families = [];
    this.selectedId = null;
    this.formVisible = true;

    document.getElementById("btn-track-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-track-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-track-create")?.addEventListener("click", () => this.create());
    document.getElementById("btn-track-update")?.addEventListener("click", () => this.update());
    document.getElementById("btn-track-delete")?.addEventListener("click", () => this.remove());
    document.getElementById("btn-track-reset")?.addEventListener("click", () => this.resetForm());
    document.getElementById("btn-track-add")?.addEventListener("click", () => this.openCreateForm());

    this.refresh();
  }

  async refresh() {
    const [trackRes, famRes] = await Promise.all([
      window.httpClient.listTracks(),
      window.httpClient.listFamilies(),
    ]);

    this.setStatus(trackRes.success ? "Musiques chargees" : (trackRes.error || "Erreur"), trackRes.success);
    if (!trackRes.success) return;

    this.items = trackRes.data?.items ?? [];
    this.families = famRes.success ? (famRes.data?.items ?? []) : [];
    this.renderCounters();
    this.renderFamilyOptions();
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

  renderFamilyOptions() {
    const select = document.getElementById("track-family");
    if (!select) return;

    select.innerHTML = `
      <option value="">Choisir une famille</option>
      ${this.families.map((item) => `<option value="${Number(item.id)}">${this.escapeHtml(item.category_name || "")} / ${this.escapeHtml(item.name)}</option>`).join("")}
    `;
  }

  renderList() {
    const list = document.getElementById("track-list");
    if (!list) return;

    if (!this.items.length) {
      list.innerHTML = `
        <div class="mq-admin-empty">
          <strong>Aucune musique</strong>
          <p class="mq-muted">Ajoute un premier morceau pour commencer a alimenter les parties MelodyQuest.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.items.map((item) => `
      <button type="button" class="mq-admin-item ${Number(item.id) === Number(this.selectedId) ? "is-selected" : ""}" data-id="${Number(item.id)}">
        <strong>${this.escapeHtml(item.title)}</strong>
        <div class="mq-admin-item__meta">
          <span class="mq-admin-badge">${this.escapeHtml(item.family_name || "Sans famille")}</span>
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
    this.formVisible = true;
    this.selectedId = Number(item.id);
    const form = document.getElementById("track-form");
    const family = document.getElementById("track-family");
    const title = document.getElementById("track-title");
    const artist = document.getElementById("track-artist");
    const url = document.getElementById("track-youtube-url");
    if (form) form.hidden = false;
    if (family) family.value = String(Number(item.family_id || 0));
    if (title) title.value = item.title || "";
    if (artist) artist.value = item.artist || "";
    if (url) url.value = item.youtube_url || "";
    this.renderList();
    this.updateFormState();
  }

  openCreateForm() {
    this.formVisible = true;
    this.selectedId = null;
    const form = document.getElementById("track-form");
    if (form) form.hidden = false;
    this.resetForm();
  }

  resetForm() {
    this.selectedId = null;
    const form = document.getElementById("track-form");
    const family = document.getElementById("track-family");
    const title = document.getElementById("track-title");
    const artist = document.getElementById("track-artist");
    const url = document.getElementById("track-youtube-url");
    if (form) form.hidden = false;
    if (family) family.value = "";
    if (title) title.value = "";
    if (artist) artist.value = "";
    if (url) url.value = "";
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
        ? "Mode modification actif. Repars sur une nouvelle fiche pour creer une autre musique sans perdre de temps."
        : "Mode creation actif. Verifie la famille, le titre et l'URL YouTube avant validation.";
    }
    if (createBtn) createBtn.disabled = !!this.selectedId;
    if (updateBtn) updateBtn.disabled = !this.selectedId;
    if (deleteBtn) deleteBtn.disabled = !this.selectedId;
    if (resetBtn) resetBtn.textContent = this.selectedId ? "Nouvelle musique" : "Vider";
  }

  async create() {
    const family_id = Number(document.getElementById("track-family")?.value ?? 0);
    const title = document.getElementById("track-title")?.value ?? "";
    const artist = document.getElementById("track-artist")?.value ?? "";
    const youtube_url = document.getElementById("track-youtube-url")?.value ?? "";
    const youtube_video_id = extractYouTubeVideoId(youtube_url);

    const res = await window.httpClient.createTrack({ family_id, title, artist, youtube_url, youtube_video_id });
    this.setStatus(res.success ? "Musique creee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.selectedId = null;
      await this.refresh();
    }
  }

  async update() {
    if (!this.selectedId) return;
    const family_id = Number(document.getElementById("track-family")?.value ?? 0);
    const title = document.getElementById("track-title")?.value ?? "";
    const artist = document.getElementById("track-artist")?.value ?? "";
    const youtube_url = document.getElementById("track-youtube-url")?.value ?? "";
    const youtube_video_id = extractYouTubeVideoId(youtube_url);

    const res = await window.httpClient.updateTrack({ id: this.selectedId, family_id, title, artist, youtube_url, youtube_video_id });
    this.setStatus(res.success ? "Musique mise a jour" : (res.error || "Erreur"), res.success);
    if (res.success) await this.refresh();
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
}
