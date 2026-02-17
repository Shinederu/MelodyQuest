import { UserModel } from "../model/UserModel.js";

export class MenuController {
  constructor() {
    this.userModel = new UserModel();

    const logoutButton = document.getElementById("btn-logout");
    const adminButton = document.getElementById("btn-nav-admin");

    logoutButton?.addEventListener("click", () => this.submitLogout());
    adminButton?.addEventListener("click", () => window.appCtrl.changeView("admin"));

    console.log("MenuController initialized");
  }

  submitLogout() {
    this.userModel.submitLogout();
  }
}
