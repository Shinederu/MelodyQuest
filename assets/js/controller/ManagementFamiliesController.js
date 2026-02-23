export class ManagementFamiliesController {
  constructor() {
    document.getElementById("btn-fam-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-fam-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-fam-create")?.addEventListener("click", () => this.create());
    document.getElementById("btn-fam-update")?.addEventListener("click", () => this.update());
    document.getElementById("btn-fam-delete")?.addEventListener("click", () => this.remove());
    this.refresh();
  }

  async refresh() {
    const res = await window.httpClient.listFamilies();
    this.setStatus(res.success ? "Familles chargees" : (res.error || "Erreur"), res.success);
    if (!res.success) return;
    const list = document.getElementById("fam-list");
    if (list) list.innerHTML = (res.data?.items ?? []).map((x) => `<li>#${x.id} ${x.name} (cat:${x.category_id})</li>`).join("");
  }

  async create() {
    const category_id = Number(document.getElementById("fam-category-id")?.value ?? 0);
    const name = document.getElementById("fam-name")?.value ?? "";
    const slug = document.getElementById("fam-slug")?.value ?? "";
    const description = document.getElementById("fam-description")?.value ?? "";
    const res = await window.httpClient.createFamily({ category_id, name, slug, description });
    this.setStatus(res.success ? "Famille creee" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  async update() {
    const id = Number(document.getElementById("fam-id")?.value ?? 0);
    const category_id = Number(document.getElementById("fam-category-id")?.value ?? 0);
    const name = document.getElementById("fam-name")?.value ?? "";
    const slug = document.getElementById("fam-slug")?.value ?? "";
    const description = document.getElementById("fam-description")?.value ?? "";
    const res = await window.httpClient.updateFamily({ id, category_id, name, slug, description });
    this.setStatus(res.success ? "Famille mise a jour" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  async remove() {
    const id = Number(document.getElementById("fam-id")?.value ?? 0);
    const res = await window.httpClient.deleteFamily(id);
    this.setStatus(res.success ? "Famille supprimee" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  setStatus(text, ok) {
    const el = document.getElementById("fam-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }
}
