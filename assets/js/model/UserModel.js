export class UserModel {
  async submitLogin(username, password) {
    const response = await window.httpClient.submitLogin({ username, password });

    if (response.success) {
      const pendingTvCode = sessionStorage.getItem("mq_pending_tv_code");
      if (pendingTvCode) {
        window.appCtrl.changeView(`tv-link?code=${encodeURIComponent(pendingTvCode)}`);
        return response;
      }

      window.appCtrl.changeView("main");
    }

    return response;
  }

  async submitRegister(username, email, password, confirmPassword) {
    return window.httpClient.submitRegister({
      username,
      email,
      password,
      password_confirm: confirmPassword,
    });
  }

  async submitLogout() {
    const response = await window.httpClient.logout();

    if (response.success) {
      localStorage.removeItem("user");
      window.appCtrl.changeView("public");
    }

    return response;
  }
}
