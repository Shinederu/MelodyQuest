import { escapeHtml, formatDate } from "../utils/ui.js?v=20260610-shared-utils";

export class ManagementSuggestionsController {
  constructor() {
    this.items = [];
    this.selectedId = null;
    this.statusFilter = "pending";

    document.getElementById("btn-suggestions-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-suggestions-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("suggestions-filter-status")?.addEventListener("change", (event) => {
      this.statusFilter = String(event?.target?.value || "pending");
      this.selectedId = null;
      this.refresh();
    });
    document.getElementById("btn-suggestion-reviewed")?.addEventListener("click", () => this.updateSelectedStatus("reviewed"));
    document.getElementById("btn-suggestion-rejected")?.addEventListener("click", () => this.updateSelectedStatus("rejected"));
    document.getElementById("btn-suggestion-pending")?.addEventListener("click", () => this.updateSelectedStatus("pending"));

    this.refresh();
  }

  async refresh() {
    const res = await window.httpClient.listSuggestions(this.statusFilter);
    if (!res.success) {
      this.setStatus(res.error || "Erreur", false);
      return;
    }

    this.items = res.data?.items ?? [];
    this.renderCounters();
    this.renderList();

    const selected = this.items.find((item) => Number(item.id) === Number(this.selectedId)) || this.items[0] || null;
    this.selectedId = selected ? Number(selected.id) : null;
    this.renderList();
    this.renderDetail();
    this.setStatus("Propositions chargées.", true);
  }

  renderCounters() {
    const count = this.items.length;
    const text = `${count} ${count > 1 ? "propositions" : "proposition"}`;
    const el = document.getElementById("suggestions-count");
    if (el) el.textContent = text;
  }

  renderList() {
    const list = document.getElementById("suggestions-list");
    if (!list) return;

    if (!this.items.length) {
      list.innerHTML = `
        <div class="mq-admin-empty">
          <strong>Aucune proposition</strong>
          <p class="mq-muted">Rien à traiter avec le filtre actuel.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.items.map((item) => {
      const title = item.suggestion_type === "new_track"
        ? (item.proposed_title || "Nouvelle musique")
        : (item.current_family_name || item.current_title || "Correction");

      return `
        <button type="button" class="mq-admin-item ${Number(item.id) === Number(this.selectedId) ? "is-selected" : ""}" data-id="${Number(item.id)}">
          <strong>${this.escapeHtml(title)}</strong>
          <div class="mq-admin-item__meta">
            <span class="mq-admin-badge">${this.escapeHtml(this.formatType(item.suggestion_type))}</span>
            <span class="mq-admin-badge ${this.getStatusClass(item.status)}">${this.escapeHtml(this.formatStatus(item.status))}</span>
            <span class="mq-muted">${this.escapeHtml(item.username || "Anonyme")}</span>
            <span class="mq-muted">${this.escapeHtml(this.formatDate(item.created_at))}</span>
          </div>
        </button>
      `;
    }).join("");

    list.querySelectorAll("[data-id]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedId = Number(button.dataset.id || 0);
        this.renderList();
        this.renderDetail();
      });
    });
  }

  renderDetail() {
    const title = document.getElementById("suggestions-detail-title");
    const helper = document.getElementById("suggestions-detail-helper");
    const meta = document.getElementById("suggestions-detail-meta");
    const body = document.getElementById("suggestions-detail-body");
    const reviewed = document.getElementById("btn-suggestion-reviewed");
    const rejected = document.getElementById("btn-suggestion-rejected");
    const pending = document.getElementById("btn-suggestion-pending");
    const item = this.getSelectedItem();

    [reviewed, rejected, pending].forEach((button) => {
      if (button) button.disabled = !item;
    });

    if (!item) {
      if (title) title.textContent = "Aucune proposition sélectionnée";
      if (helper) helper.textContent = "Choisis une proposition pour comparer les valeurs actuelles et les corrections demandées.";
      if (meta) meta.innerHTML = `<span class="mq-muted">Aucune proposition sélectionnée.</span>`;
      if (body) body.innerHTML = "";
      return;
    }

    if (title) {
      title.textContent = item.suggestion_type === "new_track"
        ? (item.proposed_title || "Nouvelle musique")
        : (item.current_family_name || item.current_title || "Correction de musique");
    }
    if (helper) {
      helper.textContent = item.note || "Compare les propositions, applique les corrections utiles dans le catalogue, puis marque la demande.";
    }
    if (meta) {
      meta.innerHTML = `
        <span class="mq-admin-badge">${this.escapeHtml(this.formatType(item.suggestion_type))}</span>
        <span class="mq-admin-badge ${this.getStatusClass(item.status)}">${this.escapeHtml(this.formatStatus(item.status))}</span>
        <span class="mq-muted">Envoyée par ${this.escapeHtml(item.username || "Anonyme")}</span>
        <span class="mq-muted">${this.escapeHtml(this.formatDate(item.created_at))}</span>
      `;
    }
    if (body) {
      body.innerHTML = this.renderSuggestionBody(item);
    }
  }

  renderSuggestionBody(item) {
    const rows = [
      ["Œuvre / réponse", item.current_family_name, item.proposed_alias],
      ["Libelle piste", item.current_title, item.proposed_title],
      ["Artiste / licence", item.current_artist, item.proposed_artist],
      ["YouTube", item.current_youtube_video_id, item.proposed_youtube_url || item.proposed_youtube_video_id],
    ];

    return `
      <div class="mq-suggestion-compare">
        ${rows.map(([label, current, proposed]) => this.renderCompareRow(label, current, proposed)).join("")}
      </div>
      ${item.note ? `
        <div class="mq-suggestion-note">
          <span class="mq-section-label">Note joueur</span>
          <p>${this.escapeHtml(item.note)}</p>
        </div>
      ` : ""}
      ${item.reviewed_at ? `
        <p class="mq-muted">Derniere revue par ${this.escapeHtml(item.reviewer_username || "admin")} le ${this.escapeHtml(this.formatDate(item.reviewed_at))}.</p>
      ` : ""}
    `;
  }

  renderCompareRow(label, current, proposed) {
    return `
      <div class="mq-suggestion-row">
        <span>${this.escapeHtml(label)}</span>
        <div>
          <small>Actuel</small>
          <strong>${this.escapeHtml(current || "-")}</strong>
        </div>
        <div class="${proposed ? "has-proposal" : ""}">
          <small>Proposé</small>
          <strong>${this.escapeHtml(proposed || "-")}</strong>
        </div>
      </div>
    `;
  }

  async updateSelectedStatus(status) {
    const item = this.getSelectedItem();
    if (!item) return;

    const res = await window.httpClient.updateSuggestionStatus(Number(item.id), status);
    this.setStatus(res.success ? "Statut mis à jour." : (res.error || "Erreur"), res.success);
    if (res.success) {
      await this.refresh();
    }
  }

  getSelectedItem() {
    return this.items.find((item) => Number(item.id) === Number(this.selectedId)) || null;
  }

  formatType(type) {
    return type === "new_track" ? "Nouvelle musique" : "Correction";
  }

  formatStatus(status) {
    if (status === "reviewed") return "Traitée";
    if (status === "rejected") return "Refusée";
    return "En attente";
  }

  getStatusClass(status) {
    if (status === "reviewed") return "mq-admin-badge--success";
    if (status === "rejected") return "mq-admin-badge--danger";
    return "mq-admin-badge--pending";
  }

  formatDate(value) {
    return formatDate(value);
  }

  setStatus(text, ok = null) {
    const el = document.getElementById("suggestions-status");
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

  escapeHtml(value) {
    return escapeHtml(value);
  }
}
