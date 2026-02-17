import { HttpService } from "../utils/HttpService.js";
import { PublicController } from "./PublicController.js";
import { MenuController } from "./MenuController.js";
import { AdminController } from "./AdminController.js";
import { HeaderModel } from "../model/HeaderModel.js";

let currentUser = null;
let headerManager = null;

export class AppController {
  constructor() {
    this.ctrl = null;

    window.httpClient = new HttpService();
    headerManager = new HeaderModel();

    document.addEventListener("submit", (e) => e.preventDefault());
    window.addEventListener("popstate", () => this.selectView());

    console.log("AppController initialized");
    this.selectView();
  }

  changeView(path) {
    this.navigateTo(path);
    this.selectView();
  }

  navigateTo(path) {
    if (window.location.pathname !== `/${path}`) {
      history.pushState({}, "", `/${path}`);
    }
  }

  async selectView() {
    let view = window.location.pathname.replace(/^\//, "").toLowerCase();

    if (!["public", "menu", "admin"].includes(view)) {
      view = "public";
    }

    if (this.ctrl && typeof this.ctrl.destroy === "function") {
      this.ctrl.destroy();
    }

    try {
      const response = await window.httpClient.accountDetails();

      if (response.success && response.data?.user) {
        currentUser = response.data.user;
        currentUser.role = String(currentUser.role ?? "").toLowerCase();

        localStorage.setItem("user", JSON.stringify(currentUser));

        if (view === "public") {
          view = "menu";
        }

        if (view === "admin" && currentUser.role !== "admin") {
          view = "menu";
        }
      } else {
        currentUser = null;
        localStorage.removeItem("user");
        view = "public";
      }
    } catch {
      currentUser = null;
      localStorage.removeItem("user");
      view = "public";
    }

    this.navigateTo(view);
    await this.loadView(view);

    switch (view) {
      case "admin":
        this.ctrl = new AdminController();
        break;
      case "menu":
        this.ctrl = new MenuController();
        break;
      default:
        this.ctrl = new PublicController();
        break;
    }
  }

  async loadView(view) {
    const app = document.getElementById("app");
    if (!app) return;

    const res = await fetch(`assets/views/${view}View.html`);
    app.innerHTML = await res.text();

    const head = document.getElementById("header");
    if (!head || !headerManager) return;

    headerManager.refresh(head, view, currentUser?.role ?? "", currentUser?.username ?? "");
  }
}

window.appCtrl = new AppController();
