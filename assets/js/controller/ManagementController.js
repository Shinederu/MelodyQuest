const MANAGEMENT_NAVIGATION = [
  ["btn-mgmt-main", "main"],
  ["btn-mgmt-categories", "management-categories"],
  ["btn-mgmt-families", "management-families"],
  ["btn-mgmt-tracks", "management-tracks"],
  ["btn-mgmt-validation", "management-validation"],
  ["btn-mgmt-suggestions", "management-suggestions"],
];

export class ManagementController {
  constructor() {
    MANAGEMENT_NAVIGATION.forEach(([buttonId, route]) => {
      document.getElementById(buttonId)?.addEventListener("click", () => window.appCtrl.changeView(route));
    });
  }
}
