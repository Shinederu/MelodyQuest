export class HeaderModel {

    constructor() {
        console.log("HeaderModel initialized");
    }

    refresh(headerId, view, role) {

        let buttonHtml = "";
        if (view !== "public") {
            buttonHtml = `
                <button type="button" style="padding: 8px 12px; cursor: pointer;">
                    Déconnexion
                </button>
            `;
        }
        let message = `<div>Bonjour !</div>`
        if (!role) {
           message = `<div>Bonjour ! ${role}</div>`
        } else {

        }

        const headerHtml = `
            <div style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 8px;">
                ${message}
                ${buttonHtml}
            </div>
        `;

        headerId.innerHTML = headerHtml;
    }
}