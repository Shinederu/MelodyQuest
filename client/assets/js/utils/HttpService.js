const AUTH_BASE_URL = 'https://api.shinederu.lol/auth/';
const MELODY_BASE_URL = 'https://api.shinederu.lol/melody/'

export class HttpService {

    async request(baseUrl, method, action, body = null) {
        const url = new URL(baseUrl);
        url.searchParams.set('action', action);

        const options = {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        };

        if(method === 'POST') {
            body = { ...body, action: action };
        }

        if (body) {
            options.body = JSON.stringify(body);
        }

        const res = await fetch(url, options);

        let json;
        try {
            json = await res.json();
        } catch {
            json = { message: "Server returned no JSON", data: null };
        }

        return {
            success: json.success ?? false,
            message: json.message ?? "",
            error: json.error ?? "",
            data: json.data ?? null
        };
    }

    /*//========================================
    *       Authentication API Section
    *///========================================

    accountDetails() {
        return this.request(AUTH_BASE_URL, 'GET', 'me');
    }

    submitLogin(data) {
        return this.request(AUTH_BASE_URL, 'POST', 'login', data);
    }

    submitRegister(data) {
        return this.request(AUTH_BASE_URL, 'POST', 'register', data);
    }

    logout() {
        return this.request(AUTH_BASE_URL, 'POST', 'logout');
    }

    /*//========================================
    *          MelodyQuest API Section
    *///========================================

    

}
