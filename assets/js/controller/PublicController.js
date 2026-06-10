import { UserModel } from "../model/UserModel.js?v=20260610-shared-utils";

export class PublicController {
  constructor() {
    this.userModel = new UserModel();
    this.authMode = "login";
    this.loginInFlight = false;
    this.registerInFlight = false;

    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const loginTab = document.getElementById("btn-auth-login-tab");
    const registerTab = document.getElementById("btn-auth-register-tab");

    loginForm?.addEventListener("submit", () => this.submitLogin());
    registerForm?.addEventListener("submit", () => this.submitRegister());
    loginTab?.addEventListener("click", () => this.setAuthMode("login"));
    registerTab?.addEventListener("click", () => this.setAuthMode("register"));
    document.getElementById("btn-public-suggest-track")?.addEventListener("click", () => window.appCtrl.changeView("suggest-track"));
    this.setAuthMode(this.authMode);
  }

  async submitLogin() {
    if (this.loginInFlight) return;

    const username = document.getElementById("login-username")?.value ?? "";
    const password = document.getElementById("login-password")?.value ?? "";
    this.loginInFlight = true;
    this.setAuthBusy("login", true);
    this.setAuthStatus("login", "Connexion en cours...", null);

    try {
      const response = await this.userModel.submitLogin(username, password);
      if (!response?.success) {
        this.setAuthStatus("login", response?.error || "Connexion impossible.", false);
      }
    } catch {
      this.setAuthStatus("login", "Connexion impossible pour le moment.", false);
    } finally {
      this.loginInFlight = false;
      this.setAuthBusy("login", false);
    }
  }

  async submitRegister() {
    if (this.registerInFlight) return;

    const username = document.getElementById("register-username")?.value ?? "";
    const email = document.getElementById("register-email")?.value ?? "";
    const password = document.getElementById("register-password")?.value ?? "";
    const confirmPassword = document.getElementById("register-confirm-password")?.value ?? "";
    if (password !== confirmPassword) {
      this.setAuthStatus("register", "Les deux mots de passe ne correspondent pas.", false);
      return;
    }

    this.registerInFlight = true;
    this.setAuthBusy("register", true);
    this.setAuthStatus("register", "Création du compte...", null);

    try {
      const response = await this.userModel.submitRegister(username, email, password, confirmPassword);
      if (response?.success) {
        this.clearRegisterSecrets();
        this.setAuthMode("login", { keepStatus: true });
        this.setAuthStatus("login", response?.message || "Compte créé. Tu peux te connecter.", true);
        return;
      }

      this.setAuthStatus("register", response?.error || "Inscription impossible.", false);
    } catch {
      this.setAuthStatus("register", "Inscription impossible pour le moment.", false);
    } finally {
      this.registerInFlight = false;
      this.setAuthBusy("register", false);
    }
  }

  setAuthMode(mode, options = {}) {
    this.authMode = mode === "register" ? "register" : "login";

    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const loginTab = document.getElementById("btn-auth-login-tab");
    const registerTab = document.getElementById("btn-auth-register-tab");
    const isLogin = this.authMode === "login";

    if (loginForm) loginForm.hidden = !isLogin;
    if (registerForm) registerForm.hidden = isLogin;

    loginTab?.classList.toggle("is-active", isLogin);
    registerTab?.classList.toggle("is-active", !isLogin);
    loginTab?.setAttribute("aria-selected", String(isLogin));
    registerTab?.setAttribute("aria-selected", String(!isLogin));

    if (!options.keepStatus) {
      this.setAuthStatus("login", "", null);
      this.setAuthStatus("register", "", null);
    }
  }

  setAuthBusy(mode, busy) {
    const button = document.getElementById(mode === "register" ? "btn-register" : "btn-login");
    if (!button) return;

    button.disabled = Boolean(busy);
    button.textContent = busy
      ? (mode === "register" ? "Création..." : "Connexion...")
      : (mode === "register" ? "S'inscrire" : "Se connecter");
  }

  setAuthStatus(mode, text, ok = null) {
    const status = document.getElementById(mode === "register" ? "register-status" : "login-status");
    if (!status) return;

    status.textContent = text || "";
    status.className = ok === true ? "status success" : ok === false ? "status error" : "status";
  }

  clearRegisterSecrets() {
    const password = document.getElementById("register-password");
    const confirmPassword = document.getElementById("register-confirm-password");
    if (password) password.value = "";
    if (confirmPassword) confirmPassword.value = "";
  }
}
