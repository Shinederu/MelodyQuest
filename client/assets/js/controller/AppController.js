import { HttpService } from "../utils/HttpService.js";
import { HeaderModel } from "../model/HeaderModel.js";
import { PublicController } from "./PublicController.js";
import { MainController } from "./MainController.js";
import { LobbyListController } from "./LobbyListController.js";
import { LobbyController } from "./LobbyController.js";
import { ManagementController } from "./ManagementController.js";
import { ManagementCategoriesController } from "./ManagementCategoriesController.js";
import { ManagementFamiliesController } from "./ManagementFamiliesController.js";
import { ManagementTracksController } from "./ManagementTracksController.js";

let currentUser = null;
let headerManager = null;

const ROUTES = {
  public: { auth: false, admin: false, controller: PublicController },
  main: { auth: true, admin: false, controller: MainController },
  "lobby-list": { auth: true, admin: false, controller: LobbyListController },
  lobby: { auth: true, admin: false, controller: LobbyController },
  management: { auth: true, admin: true, controller: ManagementController },
  "management-categories": { auth: true, admin: true, controller: ManagementCategoriesController },
  "management-families": { auth: true, admin: true, controller: ManagementFamiliesController },
  "management-tracks": { auth: true, admin: true, controller: ManagementTracksController },
};

function toBool(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const v = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on", "admin"].includes(v);
}

function normalizeUser(rawUser) {
  const user = { ...(rawUser || {}) };
  user.role = String(user.role ?? "").toLowerCase();
  user.is_admin = toBool(user.is_admin) || user.role === "admin";
  return user;
}

export class AppController {
  constructor() {
    this.ctrl = null;

    window.httpClient = new HttpService();
    headerManager = new HeaderModel();

    document.addEventListener("submit", (e) => e.preventDefault());
    window.addEventListener("hashchange", () => this.selectView());

    this.selectView();
  }

  changeView(path) {
    this.navigateTo(path);
    this.selectView();
  }

  navigateTo(path) {
    const wanted = `#/${path}`;
    if (window.location.hash !== wanted) {
      window.location.hash = wanted;
    }
  }

  async selectView() {
    let requested = window.location.hash.replace(/^#\/?/, "").toLowerCase();
    if (!requested) requested = "public";

    const session = await this.resolveSession();
    const isAdmin = Boolean(currentUser?.is_admin);

    if (!ROUTES[requested]) {
      requested = session ? "main" : "public";
    }

    const route = ROUTES[requested];
    if (route.auth && !session) {
      requested = "public";
    } else if (route.admin && !isAdmin) {
      requested = "main";
    } else if (!route.auth && session) {
      requested = "main";
    }

    if (this.ctrl && typeof this.ctrl.destroy === "function") {
      this.ctrl.destroy();
    }

    this.navigateTo(requested);
    await this.loadView(requested);

    const Controller = ROUTES[requested].controller;
    this.ctrl = new Controller();
  }

  async resolveSession() {
    try {
      const response = await window.httpClient.accountDetails();
      if (response.success && response.data?.user) {
        currentUser = normalizeUser(response.data.user);
        localStorage.setItem("user", JSON.stringify(currentUser));
        return true;
      }
    } catch {
      // noop
    }

    currentUser = null;
    localStorage.removeItem("user");
    return false;
  }

  async loadView(view) {
    const app = document.getElementById("app");
    if (!app) return;

    const res = await fetch(`assets/views/${view}View.html`);
    app.innerHTML = await res.text();

    const head = document.getElementById("header");
    if (!head || !headerManager) return;

    headerManager.refresh(head, view, currentUser?.role ?? "", currentUser?.username ?? "", Boolean(currentUser?.is_admin));
  }
}

window.appCtrl = new AppController();
