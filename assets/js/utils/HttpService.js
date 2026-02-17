const AUTH_BASE_URL = "https://api.shinederu.lol/auth/";
const MELODY_BASE_URL = "https://api.shinederu.lol/melody/";

import { createAuthClient } from "../vendor/shinederu-auth-core/index.js";

const extractMessage = (payload, fallback = "") => {
  if (!payload || typeof payload !== "object") return fallback;

  if (typeof payload.message === "string") return payload.message;

  if (payload.data && typeof payload.data === "object" && typeof payload.data.message === "string") {
    return payload.data.message;
  }

  return fallback;
};

export class HttpService {
  constructor() {
    this.authClient = createAuthClient({
      baseUrl: AUTH_BASE_URL,
      defaultCredentials: "include",
    });
  }

  mapAuthResponse(response, options = {}) {
    const { wrapUser = false } = options;

    let mappedData = response.data;
    if (wrapUser) {
      mappedData = response.data ? { user: response.data } : null;
    }

    return {
      success: response.ok,
      message: extractMessage(response.data, response.ok ? "" : response.error ?? ""),
      error: response.ok ? "" : response.error ?? "",
      data: mappedData,
    };
  }

  async request(baseUrl, method, action, body = null) {
    const url = new URL(baseUrl);
    url.searchParams.set("action", action);

    const options = {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    };

    if (method === "POST") {
      body = { ...(body ?? {}), action };
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
      data: json.data ?? null,
    };
  }

  // Authentication API Section
  async accountDetails() {
    const response = await this.authClient.me();
    return this.mapAuthResponse(response, { wrapUser: true });
  }

  async submitLogin(data) {
    const response = await this.authClient.login({
      username: data.username,
      password: data.password,
    });
    return this.mapAuthResponse(response);
  }

  async submitRegister(data) {
    const response = await this.authClient.register({
      username: data.username,
      email: data.email,
      password: data.password,
      password_confirm: data.password_confirm,
    });
    return this.mapAuthResponse(response);
  }

  async logout() {
    const response = await this.authClient.logout();
    return this.mapAuthResponse(response);
  }

  // MelodyQuest API Section
}
