export class UserModel {

    constructor() {

        console.log("UserModel initialized");
    }

    async submitLogin(username, password) {

        const response = await httpClient.submitLogin({ 'username': username, 'password': password })

        if (response.success) {
            window.appCtrl.changeView('menu');
        } else {
            alert("Login failed: " + response.error);
        }
    }

    async submitRegister(username, email, password, confirmPassword) {

        const response = await httpClient.submitRegister({ 'username': username, 'email': email, 'password': password, 'password_confirm': confirmPassword })

        if (response.success) {
            alert("Registration successful! " + response.message);
        } else {
            alert("Register failed: " + response.error);
        }
    }

    async submitLogout() {

        const response = await httpClient.logout()

        if (response.success) {
            localStorage.clear();
            window.appCtrl.changeView('public');
        } else {
            alert("Logout failed: " + response.error);
        }
    }
}