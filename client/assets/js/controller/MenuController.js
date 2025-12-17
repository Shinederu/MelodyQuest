import { UserModel } from '../model/UserModel.js';

export class MenuController {

    constructor() {
        this.userModel = new UserModel();

        document.getElementById("btn-logout").addEventListener("click", () => this.submitLogout());
        document.getElementById("btn-van-amin").addEventListener("click", () => window.appCtrl.changeView('admin'));
        
        console.log("PublicController initialized");
    }


    submitLogout() {
        this.userModel.submitLogout();
    }

}