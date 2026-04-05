import { UserModel } from "../model/UserModel.js";

export class PublicController {
  constructor() {
    this.userModel = new UserModel();
    this.registerVisible = false;

    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const toggleRegister = document.getElementById("btn-toggle-register");

    loginForm?.addEventListener("submit", () => this.submitLogin());
    registerForm?.addEventListener("submit", () => this.submitRegister());
    toggleRegister?.addEventListener("click", () => this.toggleRegisterForm());

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

  toggleRegisterForm() {
    this.registerVisible = !this.registerVisible;
    const form = document.getElementById("register-form");
    const button = document.getElementById("btn-toggle-register");
    if (form) form.hidden = !this.registerVisible;
    if (button) button.textContent = this.registerVisible ? "Masquer" : "Afficher";
  }
}
