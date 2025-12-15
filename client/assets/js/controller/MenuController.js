import { UserModel } from '../model/UserModel.js';

export class MenuController {

    constructor() {
        this.userModel = new UserModel();

        document.getElementById("btn-logout").addEventListener("click", () => this.submitLogout());

        console.log("PublicController initialized");
    }


    submitLogout() {
        this.userModel.submitLogout();
    }
}