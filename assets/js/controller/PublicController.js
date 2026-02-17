import { UserModel } from "../model/UserModel.js";

export class PublicController {
  constructor() {
    this.userModel = new UserModel();

    const loginBtn = document.getElementById("btn-login");
    const registerBtn = document.getElementById("btn-register");

    loginBtn?.addEventListener("click", () => this.submitLogin());
    registerBtn?.addEventListener("click", () => this.submitRegister());

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
}
