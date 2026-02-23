export class HeaderModel {
  constructor() {
    console.log("HeaderModel initialized");
  }

  refresh(headerElement, view, role, username) {
    const canLogout = view !== "public";

    const buttonHtml = canLogout
      ? `<button id="header-btn-logout" type="button">Deconnexion</button>`
      : "";

    const greeting = role
      ? `<div>Bonjour ${username || "joueur"} (${role})</div>`
      : `<div>Bonjour !</div>`;

    const headerHtml = `
      <div style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:2px solid #6a11cb;border-radius:12px;background:#1a1a1a;color:#f0f0f0;">
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
