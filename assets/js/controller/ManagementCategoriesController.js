function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class ManagementCategoriesController {
  constructor() {
    this.items = [];
    this.selectedId = null;

    document.getElementById("btn-cat-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-cat-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-cat-create")?.addEventListener("click", () => this.create());
    document.getElementById("btn-cat-update")?.addEventListener("click", () => this.update());
    document.getElementById("btn-cat-delete")?.addEventListener("click", () => this.remove());
    document.getElementById("btn-cat-reset")?.addEventListener("click", () => this.resetForm());

    this.refresh();
  }

  async refresh() {
    const res = await window.httpClient.listCategories();
    this.setStatus(res.success ? "Categories chargees" : (res.error || "Erreur"), res.success);
    if (!res.success) return;

    this.items = res.data?.items ?? [];
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

  renderList() {
    const list = document.getElementById("cat-list");
    if (!list) return;

    list.innerHTML = this.items.map((item) => `
      <button type="button" class="mq-admin-item ${Number(item.id) === Number(this.selectedId) ? "is-selected" : ""}" data-id="${Number(item.id)}">
        <strong>${this.escapeHtml(item.name)}</strong>
        <span class="mq-muted">${this.escapeHtml(item.slug)}</span>
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
    const nameInput = document.getElementById("cat-name");
    if (nameInput) nameInput.value = item.name || "";
    this.renderList();
    this.updateSelectionState();
  }

  resetForm() {
    this.selectedId = null;
    const nameInput = document.getElementById("cat-name");
    if (nameInput) nameInput.value = "";
    this.renderList();
    this.updateSelectionState();
  }

  updateSelectionState() {
    const title = document.getElementById("cat-form-title");
    const updateBtn = document.getElementById("btn-cat-update");
    const deleteBtn = document.getElementById("btn-cat-delete");
    if (title) title.textContent = this.selectedId ? "Modifier la categorie" : "Nouvelle categorie";
    if (updateBtn) updateBtn.disabled = !this.selectedId;
    if (deleteBtn) deleteBtn.disabled = !this.selectedId;
  }

  async create() {
    const name = document.getElementById("cat-name")?.value ?? "";
    const slug = slugify(name);
    const res = await window.httpClient.createCategory({ name, slug });
    this.setStatus(res.success ? "Categorie creee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.selectedId = null;
      await this.refresh();
    }
  }

  async update() {
    if (!this.selectedId) return;
    const name = document.getElementById("cat-name")?.value ?? "";
    const slug = slugify(name);
    const res = await window.httpClient.updateCategory({ id: this.selectedId, name, slug });
    this.setStatus(res.success ? "Categorie mise a jour" : (res.error || "Erreur"), res.success);
    if (res.success) await this.refresh();
  }

  async remove() {
    if (!this.selectedId) return;
    const res = await window.httpClient.deleteCategory(this.selectedId);
    this.setStatus(res.success ? "Categorie supprimee" : (res.error || "Erreur"), res.success);
    if (res.success) {
      this.selectedId = null;
      await this.refresh();
    }
  }

  setStatus(text, ok) {
    const el = document.getElementById("cat-status");
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
