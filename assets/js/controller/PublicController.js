import { UserModel } from '../model/UserModel.js';

export class PublicController {

    constructor() {
        this.userModel = new UserModel();

        document.getElementById("btn-login").addEventListener("click", () => this.submitLogin());
        document.getElementById("btn-register").addEventListener("click", () => this.submitRegister());

        console.log("PublicController initialized");
    }

    submitLogin() {
        let username = document.getElementById("login-username").value;
        let password = document.getElementById("login-password").value;
        this.userModel.submitLogin(username, password);
    }

    submitRegister() {
        let username = document.getElementById("register-username").value;
        let email = document.getElementById("register-email").value;
        let password = document.getElementById("register-password").value;
        let confirmPassword = document.getElementById("register-confirm-password").value;
        this.userModel.submitRegister(username, email, password, confirmPassword);
    }
}