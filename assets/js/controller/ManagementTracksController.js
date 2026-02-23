export class ManagementTracksController {
  constructor() {
    document.getElementById("btn-track-back")?.addEventListener("click", () => window.appCtrl.changeView("management"));
    document.getElementById("btn-track-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-track-create")?.addEventListener("click", () => this.create());
    document.getElementById("btn-track-update")?.addEventListener("click", () => this.update());
    document.getElementById("btn-track-delete")?.addEventListener("click", () => this.remove());
    this.refresh();
  }

  async refresh() {
    const res = await window.httpClient.listTracks();
    this.setStatus(res.success ? "Musiques chargees" : (res.error || "Erreur"), res.success);
    if (!res.success) return;
    const list = document.getElementById("track-list");
    if (list) list.innerHTML = (res.data?.items ?? []).map((x) => `<li>#${x.id} ${x.title} (family:${x.family_id})</li>`).join("");
  }

  async create() {
    const family_id = Number(document.getElementById("track-family-id")?.value ?? 0);
    const title = document.getElementById("track-title")?.value ?? "";
    const artist = document.getElementById("track-artist")?.value ?? "";
    const youtube_url = document.getElementById("track-youtube-url")?.value ?? "";
    const youtube_video_id = document.getElementById("track-youtube-id")?.value ?? "";

    const res = await window.httpClient.createTrack({ family_id, title, artist, youtube_url, youtube_video_id });
    this.setStatus(res.success ? "Musique creee" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  async update() {
    const id = Number(document.getElementById("track-id")?.value ?? 0);
    const family_id = Number(document.getElementById("track-family-id")?.value ?? 0);
    const title = document.getElementById("track-title")?.value ?? "";
    const artist = document.getElementById("track-artist")?.value ?? "";
    const youtube_url = document.getElementById("track-youtube-url")?.value ?? "";
    const youtube_video_id = document.getElementById("track-youtube-id")?.value ?? "";

    const res = await window.httpClient.updateTrack({ id, family_id, title, artist, youtube_url, youtube_video_id });
    this.setStatus(res.success ? "Musique mise a jour" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  async remove() {
    const id = Number(document.getElementById("track-id")?.value ?? 0);
    const res = await window.httpClient.deleteTrack(id);
    this.setStatus(res.success ? "Musique supprimee" : (res.error || "Erreur"), res.success);
    if (res.success) this.refresh();
  }

  setStatus(text, ok) {
    const el = document.getElementById("track-status");
    if (!el) return;
    el.textContent = text;
    el.className = ok ? "status success" : "status error";
  }
}
