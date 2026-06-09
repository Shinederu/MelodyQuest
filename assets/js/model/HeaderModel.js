export class HeaderModel {
  refresh(headerElement, view, role, username, isAdmin = false) {
    if (view === "public" || view === "tv") {
      headerElement.innerHTML = "";
      return;
    }

    const hasUser = Boolean(username);
    const canLogout = view !== "public" && hasUser;

    const buttonHtml = canLogout
      ? `<button id="header-btn-logout" type="button" class="mq-danger">Deconnexion</button>`
      : "";

    const roleLabel = isAdmin ? "admin" : (role || "user");
    const safeUsername = this.escapeHtml(username || "visiteur");
    const safeRole = this.escapeHtml(roleLabel);
    const page = this.getPageMeta(view);
    const pageHtml = page ? this.renderPageMeta(page) : "";

    const headerHtml = `
      <div class="mq-topbar">
        <div class="mq-topbar__brand">
          <div class="mq-topbar__eyebrow">MelodyQuest</div>
          <div class="mq-topbar__user">${hasUser ? `Bonjour ${safeUsername}` : "MelodyQuest"}</div>
        </div>
        ${pageHtml}
        <div class="mq-topbar__actions">
          ${hasUser ? `<span class="mq-topbar__role">${safeRole}</span>` : ""}
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

  getPageMeta(view) {
    const pages = {
      main: {
        eyebrow: "Blindtest entre amis",
        title: "Jouer maintenant",
        description: "Creer un salon, partager le code, lancer la musique.",
      },
      "suggest-track": {
        eyebrow: "Contribution",
        title: "Proposer une musique",
        description: "Envoie une piste ou une correction à vérifier.",
      },
      "tv-link": {
        eyebrow: "Mode TV",
        title: "Lier un écran",
        description: "Associe une télévision au salon en cours.",
      },
      "lobby-list": {
        eyebrow: "Rejoindre",
        title: "Trouver une partie",
        description: "Entre un code ou choisis un salon public.",
      },
      lobby: {
        eyebrow: "Salon d'attente",
        title: "Salon",
        titleId: "lobby-title",
        description: "Chargement du salon...",
        descriptionId: "lobby-meta",
        chips: [
          { id: "lobby-rounds", text: "--" },
          { id: "lobby-timer", text: "--" },
        ],
      },
      game: {
        eyebrow: "Session en cours",
        title: "Partie en cours",
        titleId: "game-title",
      },
      result: {
        eyebrow: "Fin de partie",
        title: "Partie terminee",
        titleId: "result-title",
        description: "Les scores sont poses. Le salon se prepare pour une revanche.",
      },
      management: {
        eyebrow: "Administration",
        title: "Management",
        description: "Gestion du catalogue MelodyQuest.",
      },
      "management-categories": {
        eyebrow: "Catalogue",
        title: "Gestion des categories",
        description: "Selectionne une categorie ou cree-en une nouvelle.",
      },
      "management-families": {
        eyebrow: "Catalogue",
        title: "Gestion des oeuvres",
        description: "Regroupe les musiques par réponse attendue.",
      },
      "management-tracks": {
        eyebrow: "Catalogue",
        title: "Gestion des musiques",
        description: "Ajoute et corrige les pistes jouables.",
      },
      "management-validation": {
        eyebrow: "Administration",
        title: "Verification / validation",
        description: "Controle les nouvelles musiques avant de les rendre jouables.",
      },
      "management-suggestions": {
        eyebrow: "Administration",
        title: "Suggestions joueurs",
        description: "Trie les corrections, alias et nouvelles musiques proposés.",
      },
    };

    return pages[view] || null;
  }

  renderPageMeta(page) {
    const titleAttr = page.titleId ? ` id="${page.titleId}"` : "";
    const descriptionAttr = page.descriptionId ? ` id="${page.descriptionId}"` : "";
    const description = page.description
      ? `<p${descriptionAttr} class="mq-topbar__page-copy">${this.escapeHtml(page.description)}</p>`
      : "";
    const chips = Array.isArray(page.chips) && page.chips.length
      ? `
        <div class="mq-topbar__page-chips">
          ${page.chips.map((chip) => `<span id="${chip.id}" class="mq-chip">${this.escapeHtml(chip.text)}</span>`).join("")}
        </div>
      `
      : "";

    return `
      <div class="mq-topbar__page" aria-label="Page active">
        <div class="mq-topbar__page-eyebrow">${this.escapeHtml(page.eyebrow || "Page")}</div>
        <div class="mq-topbar__page-title">
          <strong${titleAttr}>${this.escapeHtml(page.title || "")}</strong>
          ${chips}
        </div>
        ${description}
      </div>
    `;
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
