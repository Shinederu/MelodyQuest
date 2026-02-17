import { EMPTY_SESSION, defaultTransformUser, mergeEndpoints, toQueryString } from "./helpers.js";
import { createBrowserStorage } from "./storage.js";
const DEFAULT_STORAGE_KEY = "shinederu_auth_session";
const parseResponseData = async (response) => {
    if (response.status === 204)
        return null;
    const text = await response.text();
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
};
const getErrorMessage = (data, fallback) => {
    if (typeof data === "string" && data.trim())
        return data;
    if (data && typeof data === "object") {
        const record = data;
        if (typeof record.error === "string")
            return record.error;
        if (typeof record.message === "string")
            return record.message;
    }
    return fallback;
};
const getGlobalFetcher = () => {
    if (typeof globalThis === "undefined")
        return null;
    if (typeof globalThis.fetch !== "function")
        return null;
    return globalThis.fetch.bind(globalThis);
};
export class AuthClient {
    constructor(config) {
        this.state = {
            session: EMPTY_SESSION,
            isLoading: false,
            error: null,
        };
        this.listeners = new Set();
        this.baseUrl = config.baseUrl;
        this.storageKey = config.storageKey ?? DEFAULT_STORAGE_KEY;
        this.defaultCredentials = config.defaultCredentials ?? "include";
        this.storage = config.storage ?? createBrowserStorage();
        this.fetcher = config.fetcher ?? getGlobalFetcher();
        this.endpoints = mergeEndpoints(config.endpoints);
        this.transformUser = config.transformUser ?? defaultTransformUser;
        this.restoreSession();
    }
    getState() {
        return this.state;
    }
    getSession() {
        return this.state.session;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.state);
        return () => {
            this.listeners.delete(listener);
        };
    }
    restoreSession() {
        const raw = this.storage.getItem(this.storageKey);
        if (!raw) {
            this.updateState({ session: EMPTY_SESSION });
            return EMPTY_SESSION;
        }
        try {
            const parsed = JSON.parse(raw);
            const session = {
                isAuthenticated: Boolean(parsed?.isAuthenticated),
                user: parsed?.user ?? null,
                updatedAt: parsed?.updatedAt ?? Date.now(),
            };
            this.updateState({ session });
            return session;
        }
        catch {
            this.storage.removeItem(this.storageKey);
            this.updateState({ session: EMPTY_SESSION });
            return EMPTY_SESSION;
        }
    }
    clearSession() {
        this.storage.removeItem(this.storageKey);
        this.updateState({ session: { ...EMPTY_SESSION, updatedAt: Date.now() } });
    }
    async login(credentials) {
        const response = await this.invokeAction("POST", "login", credentials);
        if (response.ok) {
            const user = this.transformUser(response.data);
            if (user)
                this.setSession(user);
        }
        return response;
    }
    async register(payload) {
        return this.invokeAction("POST", "register", payload);
    }
    async me() {
        const response = await this.invokeAction("GET", "me");
        const user = this.transformUser(response.data);
        if (response.ok && user) {
            this.setSession(user);
            return { ...response, data: user };
        }
        if (!response.ok) {
            this.clearSession();
        }
        return { ...response, data: user };
    }
    async logout() {
        const response = await this.invokeAction("POST", "logout");
        this.clearSession();
        return response;
    }
    async logoutAll() {
        const response = await this.invokeAction("POST", "logoutAll");
        this.clearSession();
        return response;
    }
    async requestPasswordReset(email) {
        return this.invokeAction("POST", "requestPasswordReset", { email });
    }
    async resetPassword(token, password, passwordConfirm) {
        return this.invokeAction("PUT", "resetPassword", {
            token,
            password,
            passwordConfirm,
        });
    }
    async requestEmailUpdate(email, emailConfirm) {
        return this.invokeAction("PUT", "requestEmailUpdate", { email, emailConfirm });
    }
    async confirmEmailUpdate(token) {
        return this.invokeAction("POST", "confirmEmailUpdate", { token });
    }
    async verifyEmail(token) {
        return this.invokeAction("POST", "verifyEmail", { token });
    }
    async revokeRegister(token) {
        return this.invokeAction("POST", "revokeRegister", { token });
    }
    async revokeEmailUpdate(token) {
        return this.invokeAction("POST", "revokeEmailUpdate", { token });
    }
    async updateProfile(username) {
        return this.invokeAction("POST", "updateProfile", { username });
    }
    async updateAvatar(file, fileName = "avatar.png") {
        const fd = new FormData();
        fd.append("file", file, fileName);
        return this.invokeAction("POST", "updateAvatar", fd);
    }
    async deleteAccount(password) {
        const response = await this.invokeAction("DELETE", "deleteAccount", { password });
        if (response.ok) {
            this.clearSession();
        }
        return response;
    }
    async invoke(method, action, payload) {
        return this.request({ method, payload: payload ?? null }, action);
    }
    setSession(user) {
        const session = {
            isAuthenticated: true,
            user,
            updatedAt: Date.now(),
        };
        this.storage.setItem(this.storageKey, JSON.stringify(session));
        this.updateState({ session });
    }
    async invokeAction(method, actionKey, payload) {
        return this.request({ method, payload: payload ?? null }, actionKey);
    }
    async request(config, actionOrPath) {
        this.updateState({ isLoading: true, error: null });
        if (!this.fetcher) {
            const message = "No fetch implementation available. Provide `fetcher` in AuthClientConfig.";
            this.updateState({ isLoading: false, error: message });
            return {
                ok: false,
                status: 0,
                data: null,
                error: message,
            };
        }
        const endpoint = this.endpoints[actionOrPath] ?? "";
        const targetUrl = endpoint ? `${this.baseUrl}${endpoint}` : this.baseUrl;
        const method = config.method ?? "GET";
        let url = targetUrl;
        let body = null;
        if (config.payload instanceof FormData) {
            config.payload.append("action", actionOrPath);
            body = config.payload;
        }
        else {
            const payload = {
                action: actionOrPath,
                ...(config.payload ?? {}),
            };
            if (method === "GET" || method === "DELETE") {
                const query = toQueryString(payload);
                url = query ? `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}${query}` : targetUrl;
            }
            else {
                body = JSON.stringify(payload);
            }
        }
        const headers = {
            Accept: "application/json",
            ...(config.headers ?? {}),
        };
        if (body && !(body instanceof FormData) && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
        }
        try {
            const response = await this.fetcher(url, {
                method,
                body: method === "GET" || method === "DELETE" ? null : body,
                credentials: config.credentials ?? this.defaultCredentials,
                headers,
                signal: config.signal,
            });
            const data = await parseResponseData(response);
            if (!response.ok) {
                const errorMessage = getErrorMessage(data, response.statusText || "Request failed");
                this.updateState({ isLoading: false, error: errorMessage });
                return {
                    ok: false,
                    status: response.status,
                    data,
                    error: errorMessage,
                };
            }
            this.updateState({ isLoading: false, error: null });
            return {
                ok: true,
                status: response.status,
                data,
                error: null,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown network error";
            this.updateState({ isLoading: false, error: message });
            return {
                ok: false,
                status: 0,
                data: null,
                error: message,
            };
        }
    }
    updateState(partial) {
        this.state = {
            ...this.state,
            ...partial,
        };
        this.listeners.forEach((listener) => listener(this.state));
    }
}
export const createAuthClient = (config) => new AuthClient(config);
//# sourceMappingURL=AuthClient.js.map