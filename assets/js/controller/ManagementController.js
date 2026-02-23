export class ManagementController {
  constructor() {
    document.getElementById("btn-mgmt-main")?.addEventListener("click", () => window.appCtrl.changeView("main"));
    document.getElementById("btn-mgmt-categories")?.addEventListener("click", () => window.appCtrl.changeView("management-categories"));
    document.getElementById("btn-mgmt-families")?.addEventListener("click", () => window.appCtrl.changeView("management-families"));
    document.getElementById("btn-mgmt-tracks")?.addEventListener("click", () => window.appCtrl.changeView("management-tracks"));
  }
}
