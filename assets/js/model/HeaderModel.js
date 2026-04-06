export class HeaderModel {
  refresh(headerElement, view, role, username, isAdmin = false) {
    if (view === "public") {
      headerElement.innerHTML = "";
      return;
    }

    const canLogout = view !== "public";

    const buttonHtml = canLogout
      ? `<button id="header-btn-logout" type="button" class="mq-danger">Deconnexion</button>`
      : "";

    const roleLabel = isAdmin ? "admin" : (role || "user");
    const safeUsername = this.escapeHtml(username || "joueur");
    const safeRole = this.escapeHtml(roleLabel);

    const headerHtml = `
      <div class="mq-topbar">
        <div class="mq-topbar__brand">
          <div class="mq-topbar__eyebrow">MelodyQuest</div>
          <div class="mq-topbar__user">Bonjour ${safeUsername}</div>
        </div>
        <div class="mq-topbar__actions">
          <span class="mq-topbar__role">${safeRole}</span>
          ${buttonHtml}
        </div>
      </div>
    `;

    headerElement.innerHTML = headerHtml;

    if (canLogout) {
      const logoutButton = document.getElementById("header-btn-logout");
      logoutButton?.addEventListener("click", async () => {
        const response = await window.httpClient.logout();
        if (response.success) {
          localStorage.removeItem("user");
          window.appCtrl.changeView("public");
        } else {
          alert("Logout failed: " + response.error);
        }
      });
    }
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
