import { UserModel } from "../model/UserModel.js?v=20260609-mobile-ui-v2";

export class PublicController {
  constructor() {
    this.userModel = new UserModel();
    this.authMode = "login";

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

    console.log("PublicController initialized");
  }

  submitLogin() {
    const username = document.getElementById("login-username")?.value ?? "";
    const password = document.getElementById("login-password")?.value ?? "";
    this.userModel.submitLogin(username, password);
  }

  submitRegister() {
    const username = document.getElementById("register-username")?.value ?? "";
    const email = document.getElementById("register-email")?.value ?? "";
    const password = document.getElementById("register-password")?.value ?? "";
    const confirmPassword = document.getElementById("register-confirm-password")?.value ?? "";
    this.userModel.submitRegister(username, email, password, confirmPassword);
  }

  setAuthMode(mode) {
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
  }
}
