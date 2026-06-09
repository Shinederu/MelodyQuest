export class UserModel {
  constructor() {
    console.log("UserModel initialized");
  }

  async submitLogin(username, password) {
    const response = await window.httpClient.submitLogin({ username, password });

    if (response.success) {
      const pendingTvCode = sessionStorage.getItem("mq_pending_tv_code");
      if (pendingTvCode) {
        window.appCtrl.changeView(`tv-link?code=${encodeURIComponent(pendingTvCode)}`);
        return;
      }

      window.appCtrl.changeView("main");
    } else {
      alert("Login failed: " + response.error);
    }
  }

  async submitRegister(username, email, password, confirmPassword) {
    const response = await window.httpClient.submitRegister({
      username,
      email,
      password,
      password_confirm: confirmPassword,
    });

    if (response.success) {
      alert("Registration successful! " + (response.message || ""));
    } else {
      alert("Register failed: " + response.error);
    }
  }

  async submitLogout() {
    const response = await window.httpClient.logout();

    if (response.success) {
      localStorage.removeItem("user");
      window.appCtrl.changeView("public");
    } else {
      alert("Logout failed: " + response.error);
    }
  }
}
