export class HeaderModel {
  refresh(headerElement, view, role, username, isAdmin = false) {
    const canLogout = view !== "public";

    const buttonHtml = canLogout
      ? `<button id="header-btn-logout" type="button" class="mq-danger">Deconnexion</button>`
      : "";

    const roleLabel = isAdmin ? "admin" : (role || "user");
    const greeting = `<div>Bonjour ${username || "joueur"} (${roleLabel})</div>`;

    const headerHtml = `
      <div class="mq-card" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;">
        ${greeting}
        ${buttonHtml}
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
}
