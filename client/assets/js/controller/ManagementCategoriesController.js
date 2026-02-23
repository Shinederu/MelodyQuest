export class ManagementCategoriesController {
  constructor() {
    document.getElementById("btn-cat-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-cat-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-cat-create")?.addEventListener("click", () => this.create());
    document.getElementById("btn-cat-update")?.addEventListener("click", () => this.update());
    document.getElementById("btn-cat-delete")?.addEventListener("click", () => this.remove());
    this.refresh();
  }

  async refresh() {
    const res = await window.httpClient.listCategories();
    this.setStatus(res.success ? "Categories chargees" : (res.error || "Erreur"), res.success);
    if (!res.success) return;
    const list = document.getElementById("cat-list");
    if (list) list.innerHTML = (res.data?.items ?? []).map((x) => `<li>#${x.id} ${x.name} (${x.slug})</li>`).join("");
  }

  async create() {
    const name = document.getElementById("cat-name")?.value ?? "";
    const slug = document.getElementById("cat-slug")?.value ?? "";
    const res = await window.httpClient.createCategory({ name, slug });
    this.setStatus(res.success ? "Categorie creee" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  async update() {
    const id = Number(document.getElementById("cat-id")?.value ?? 0);
    const name = document.getElementById("cat-name")?.value ?? "";
    const slug = document.getElementById("cat-slug")?.value ?? "";
    const res = await window.httpClient.updateCategory({ id, name, slug });
    this.setStatus(res.success ? "Categorie mise a jour" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  async remove() {
    const id = Number(document.getElementById("cat-id")?.value ?? 0);
    const res = await window.httpClient.deleteCategory(id);
    this.setStatus(res.success ? "Categorie supprimee" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  setStatus(text, ok) {
    const el = document.getElementById("cat-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }
}
