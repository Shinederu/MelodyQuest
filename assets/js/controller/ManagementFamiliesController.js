function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class ManagementFamiliesController {
  constructor() {
    this.items = [];
    this.categories = [];
    this.selectedId = null;
    this.formVisible = false;

    document.getElementById("btn-fam-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-fam-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-fam-create")?.addEventListener("click", () => this.create());
    document.getElementById("btn-fam-update")?.addEventListener("click", () => this.update());
    document.getElementById("btn-fam-delete")?.addEventListener("click", () => this.remove());
    document.getElementById("btn-fam-reset")?.addEventListener("click", () => this.resetForm());
    document.getElementById("btn-fam-add")?.addEventListener("click", () => this.openCreateForm());

    this.refresh();
  }

  async refresh() {
    const [famRes, catRes] = await Promise.all([
      window.httpClient.listFamilies(),
      window.httpClient.listCategories(),
    ]);

    this.setStatus(famRes.success ? "Familles chargees" : (famRes.error || "Erreur"), famRes.success);
    if (!famRes.success) return;

    this.items = famRes.data?.items ?? [];
    this.categories = catRes.success ? (catRes.data?.items ?? []) : [];
    this.renderCategoryOptions();
    this.renderList();

    if (this.selectedId) {
      const selected = this.items.find((item) => Number(item.id) === Number(this.selectedId));
      if (selected) {
        this.fillForm(selected);
        return;
      }
    }

    if (!this.formVisible) {
      this.hideForm();
      return;
    }

    this.resetForm();
  }

  renderCategoryOptions() {
    const select = document.getElementById("fam-category");
    if (!select) return;

    select.innerHTML = `
      <option value="">Choisir une categorie</option>
      ${this.categories.map((item) => `<option value="${Number(item.id)}">${this.escapeHtml(item.name)}</option>`).join("")}
    `;
  }

  renderList() {
    const list = document.getElementById("fam-list");
    if (!list) return;

    list.innerHTML = this.items.map((item) => `
      <button type="button" class="mq-admin-item ${Number(item.id) === Number(this.selectedId) ? "is-selected" : ""}" data-id="${Number(item.id)}">
        <strong>${this.escapeHtml(item.name)}</strong>
        <span class="mq-muted">${this.escapeHtml(item.category_name || "")}</span>
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
    const form = document.getElementById("fam-form");
    const category = document.getElementById("fam-category");
    const name = document.getElementById("fam-name");
    const description = document.getElementById("fam-description");
    if (form) form.hidden = false;
    if (category) category.value = String(Number(item.category_id || 0));
    if (name) name.value = item.name || "";
    if (description) description.value = item.description || "";
    this.renderList();
    this.updateFormState();
  }

  openCreateForm() {
    this.formVisible = true;
    this.selectedId = null;
    const form = document.getElementById("fam-form");
    if (form) form.hidden = false;
    this.resetForm();
  }

  hideForm() {
    const form = document.getElementById("fam-form");
    if (form) form.hidden = true;
    this.updateFormState();
  }

  resetForm() {
    this.selectedId = null;
    const category = document.getElementById("fam-category");
    const name = document.getElementById("fam-name");
    const description = document.getElementById("fam-description");
    if (category) category.value = "";
    if (name) name.value = "";
    if (description) description.value = "";
    this.renderList();
    this.updateFormState();
  }

  updateFormState() {
    const title = document.getElementById("fam-form-title");
    const updateBtn = document.getElementById("btn-fam-update");
    const deleteBtn = document.getElementById("btn-fam-delete");
    const resetBtn = document.getElementById("btn-fam-reset");
    if (title) title.textContent = this.selectedId ? "Modifier la famille" : "Nouvelle famille";
    if (updateBtn) updateBtn.disabled = !this.selectedId;
    if (deleteBtn) deleteBtn.disabled = !this.selectedId;
    if (resetBtn) resetBtn.textContent = this.selectedId ? "Annuler la selection" : "Vider";
  }

  async create() {
    const category_id = Number(document.getElementById("fam-category")?.value ?? 0);
    const name = document.getElementById("fam-name")?.value ?? "";
    const description = document.getElementById("fam-description")?.value ?? "";
    const slug = slugify(name);
    const res = await window.httpClient.createFamily({ category_id, name, slug, description });
    this.setStatus(res.success ? "Famille creee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.selectedId = null;
      await this.refresh();
    }
  }

  async update() {
    if (!this.selectedId) return;
    const category_id = Number(document.getElementById("fam-category")?.value ?? 0);
    const name = document.getElementById("fam-name")?.value ?? "";
    const description = document.getElementById("fam-description")?.value ?? "";
    const slug = slugify(name);
    const res = await window.httpClient.updateFamily({ id: this.selectedId, category_id, name, slug, description });
    this.setStatus(res.success ? "Famille mise a jour" : (res.error || "Erreur"), res.success);
    if (res.success) await this.refresh();
  }

  async remove() {
    if (!this.selectedId) return;
    const res = await window.httpClient.deleteFamily(this.selectedId);
    this.setStatus(res.success ? "Famille supprimee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.selectedId = null;
      await this.refresh();
    }
  }

  setStatus(text, ok) {
    const el = document.getElementById("fam-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
}
