import { HttpService } from "../utils/HttpService.js";
import { PublicController } from "./PublicController.js";
import { MenuController } from "./MenuController.js";
import { AdminController } from "./AdminController.js";
import { HeaderModel } from "../model/HeaderModel.js";


// Initialize global variables

let currentUser = null;
let headerManager = null;

export class AppController {
    constructor() {
        this.ctrl = null;

        // Initialize the HTTP service
        window.httpClient = new HttpService();

        // Initialize header model
        let headerManager = new HeaderModel();

        // Prevent default form submission globally
        document.addEventListener('submit', (e) => e.preventDefault());

        // Add event listeners for hash changes and initial load
        window.addEventListener('popstate', () => this.selectView());

        console.log("AppController initialized");

        // Select the initial view
        this.selectView();
    }

    changeView(path) {
        this.navigateTo(path);
        this.selectView();
    }


    navigateTo(path) {
        // Update URL without reloading the page
        if (window.location.pathname !== `/${path}`) {
            history.pushState({}, '', `/${path}`);
        }
    }


    async selectView() {

        // Get the view key from the URL
        let view = window.location.pathname.replace(/^\//, '').toLowerCase()

        // Vérifie que la vue existe
        if (!['public', 'menu', 'admin'].includes(view)) {
            view = 'public';
        }

        // Call the destroy method of the current controller if it exists
        if (this.ctrl && typeof this.ctrl.destroy === 'function') {
            this.ctrl.destroy();
        }

        try {
            // Retrieve account details
            const response = await httpClient.accountDetails();

            if (response.success) {
                currentUser = response.data.user;
                currentUser.role = currentUser.role.toLowerCase();

                localStorage.setItem('user', currentUser);

                // Automaticaly redirect to menu if connected
                if (view === 'public') {
                    view = 'menu';
                }

                // Only admin can access admin view
                if (view === 'admin' && currentUser.role !== 'admin') {
                    view = 'admin';
                }

            } else {
                // Not logged in or error, public access only
                view = 'public';
            }
        } catch {
            // In case of error, default to public view
            view = 'public';
        }

        // Navigate to the selected view and load it
        this.navigateTo(view);
        await this.loadView(view);

        // Initialize the appropriate controller based on the view
        switch (view) {
            case 'admin': this.ctrl = new AdminController(); break;
            case 'menu': this.ctrl = new MenuController(); break;
            default: this.ctrl = new PublicController(); break;
        }
    }

    // Charge le fichier HTML correspondant à la vue puis l'injecte dans #app
    async loadView(view) {
        const app = document.getElementById('app');
        if (!app) return;   // Sécurité si l'élément n'existe pas

        // Charge le fichier HTML de la vue
        const res = await fetch(`assets/views/${view}View.html`);
        app.innerHTML = await res.text();

        const head = document.getElementById("header");
        if (!head) return;
        headerManager.refresh(head, view, currentUser.role);
    }
}

// Expose le contrôleur global pour faciliter le debug
window.appCtrl = new AppController();
