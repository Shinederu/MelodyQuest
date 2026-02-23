export class MainController {
  constructor() {
    document.getElementById("btn-main-create")?.addEventListener("click", () => this.createLobby());
    document.getElementById("btn-main-join")?.addEventListener("click", () => window.appCtrl.changeView("lobby-list"));
  }

  async createLobby() {
    const res = await window.httpClient.createLobby({
      name: "Nouveau lobby",
      visibility: "private",
      max_players: 8,
      round_duration_seconds: 30,
    });

    const status = document.getElementById("main-status");
    if (status) {
      status.textContent = res.success ? "Lobby cree" : (res.error || "Erreur");
      status.className = res.success ? "status success" : "status error";
    }

    if (res.success && res.data?.lobby) {
      localStorage.setItem("mq_current_lobby", JSON.stringify({
        id: Number(res.data.lobby.id || 0),
        lobby_code: String(res.data.lobby.lobby_code || "").toUpperCase(),
        name: String(res.data.lobby.name || ""),
      }));
      window.appCtrl.changeView("lobby");
    }
  }
}
