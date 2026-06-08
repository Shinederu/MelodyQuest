import { HttpService } from "../utils/HttpService.js?v=20260608-playtest-notes";
import { HeaderModel } from "../model/HeaderModel.js?v=20260608-playtest-notes";
import { PublicController } from "./PublicController.js?v=20260608-playtest-notes";
import { SuggestTrackController } from "./SuggestTrackController.js?v=20260608-playtest-notes";
import { MainController } from "./MainController.js?v=20260608-playtest-notes";
import { LobbyController } from "./LobbyController.js?v=20260608-playtest-notes";
import { LobbyListController } from "./LobbyListController.js?v=20260607-game-options";
import { GameController } from "./GameController.js?v=20260608-playtest-notes";
import { ResultController } from "./ResultController.js?v=20260606-player-flow";
import { ManagementController } from "./ManagementController.js?v=20260608-playtest-notes";
import { ManagementCategoriesController } from "./ManagementCategoriesController.js?v=20260606-clean-status";
import { ManagementFamiliesController } from "./ManagementFamiliesController.js?v=20260606-clean-status";
import { ManagementTracksController } from "./ManagementTracksController.js?v=20260606-clean-status";
import { ManagementValidationController } from "./ManagementValidationController.js?v=20260607-validation-aliases";
import { ManagementSuggestionsController } from "./ManagementSuggestionsController.js?v=20260608-playtest-notes";

const ASSET_VERSION = "20260608-playtest-notes";

let currentUser = null;
let headerManager = null;

const ROUTES = {
  public: { auth: false, admin: false, controller: PublicController },
  "suggest-track": { auth: false, admin: false, allowAuthed: true, controller: SuggestTrackController },
  main: { auth: true, admin: false, controller: MainController },
  "lobby-list": { auth: true, admin: false, controller: LobbyListController },
  lobby: { auth: true, admin: false, controller: LobbyController },
  game: { auth: true, admin: false, controller: GameController },
  result: { auth: true, admin: false, controller: ResultController },
  management: { auth: true, admin: true, controller: ManagementController },
  "management-categories": { auth: true, admin: true, controller: ManagementCategoriesController },
  "management-families": { auth: true, admin: true, controller: ManagementFamiliesController },
  "management-tracks": { auth: true, admin: true, controller: ManagementTracksController },
  "management-validation": { auth: true, admin: true, controller: ManagementValidationController },
  "management-suggestions": { auth: true, admin: true, controller: ManagementSuggestionsController },
};

function toBool(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const v = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on", "admin"].includes(v);
}

function hasProjectPermission(user, project, permission) {
  const projectPermissions = user?.project_access?.permissions?.[project];
  if (!projectPermissions || typeof projectPermissions !== "object") {
    return false;
  }

  return toBool(projectPermissions[permission]);
}

function normalizeUser(rawUser) {
  const user = { ...(rawUser || {}) };
  user.role = String(user.role ?? "").toLowerCase();
  user.is_admin = (
    toBool(user.is_admin) ||
    user.role === "admin" ||
    toBool(user.project_access?.is_global_admin) ||
    hasProjectPermission(user, "melodyquest", "catalog_manage")
  );
  return user;
}

export class AppController {
  constructor() {
    this.ctrl = null;
    this.selectViewRunId = 0;

    window.httpClient = new HttpService();
    headerManager = new HeaderModel();

    document.addEventListener("submit", (e) => e.preventDefault());
    window.addEventListener("hashchange", () => this.selectView());

    this.selectView();
  }

  changeView(path, options = {}) {
    const force = Boolean(options?.force);
    const changed = this.navigateTo(path);
    if (!changed && force) {
      this.selectView();
    }
  }

  navigateTo(path) {
    const wanted = `#/${path}`;
    if (window.location.hash !== wanted) {
      window.location.hash = wanted;
      return true;
    }
    return false;
  }

  async selectView() {
    const runId = ++this.selectViewRunId;
    const rawRequested = window.location.hash.replace(/^#\/?/, "");
    const [requestedPath, requestedQuery = ""] = rawRequested.split("?");
    let requested = requestedPath.toLowerCase();
    const routeParams = new URLSearchParams(requestedQuery);
    if (!requested) requested = "public";

    if (this.ctrl && typeof this.ctrl.destroy === "function") {
      this.ctrl.destroy();
      this.ctrl = null;
    }

    const session = await this.resolveSession();
    if (runId !== this.selectViewRunId) {
      return;
    }

    const isAdmin = Boolean(currentUser?.is_admin);

    if (!ROUTES[requested]) {
      requested = session ? "main" : "public";
    }

    const route = ROUTES[requested];
    if (route.auth && !session) {
      const sharedLobbyCode = requested === "lobby" ? String(routeParams.get("code") || "").trim().toUpperCase() : "";
      if (sharedLobbyCode) {
        sessionStorage.setItem("mq_pending_lobby_code", sharedLobbyCode);
      }
      requested = "public";
    } else if (route.admin && !isAdmin) {
      requested = "main";
    } else if (!route.auth && session && !route.allowAuthed) {
      requested = "main";
    }

    if (this.navigateTo(requested)) {
      return;
    }

    await this.loadView(requested);
    if (runId !== this.selectViewRunId) {
      return;
    }

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

    const res = await fetch(`assets/views/${view}View.html?v=${ASSET_VERSION}`, { cache: "no-cache" });
    app.innerHTML = await res.text();

    const head = document.getElementById("header");
    if (!head || !headerManager) return;

    headerManager.refresh(head, view, currentUser?.role ?? "", currentUser?.username ?? "", Boolean(currentUser?.is_admin));
  }
}

window.appCtrl = new AppController();
