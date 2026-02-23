const API_ROOT = window.__SHINEDERU_API_ROOT__ || "https://api.shinederu.lol";
const AUTH_BASE_URL = `${API_ROOT}/auth/`;
const MELODY_BASE_URL = `${API_ROOT}/melodyquest/`;

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

    if (method === "GET" || method === "DELETE") {
      if (body && typeof body === "object") {
        Object.entries(body).forEach(([key, value]) => {
          if (value === undefined || value === null || value === "") return;
          url.searchParams.set(key, String(value));
        });
      }
    } else {
      const payload = { ...(body ?? {}), action };
      options.body = JSON.stringify(payload);
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
  async createLobby(data) {
    return this.request(MELODY_BASE_URL, "POST", "createLobby", data);
  }

  async joinLobby(lobbyCode) {
    return this.request(MELODY_BASE_URL, "POST", "joinLobby", {
      lobby_code: lobbyCode,
    });
  }

  async leaveLobby(lobbyId) {
    return this.request(MELODY_BASE_URL, "POST", "leaveLobby", {
      lobby_id: lobbyId,
    });
  }

  async getLobbyByCode(lobbyCode) {
    return this.request(MELODY_BASE_URL, "GET", "getLobbyByCode", {
      lobby_code: lobbyCode,
    });
  }

  async updateLobbyConfig(data) {
    return this.request(MELODY_BASE_URL, "PUT", "updateLobbyConfig", data);
  }

  async syncPlayback(data) {
    return this.request(MELODY_BASE_URL, "POST", "syncPlayback", data);
  }

  async getPlaybackState(lobbyId) {
    return this.request(MELODY_BASE_URL, "GET", "getPlaybackState", {
      lobby_id: lobbyId,
    });
  }

  async addTrackToPool(lobbyId, trackId) {
    return this.request(MELODY_BASE_URL, "POST", "addTrackToPool", {
      lobby_id: lobbyId,
      track_id: trackId,
    });
  }

  async removeTrackFromPool(lobbyId, trackId) {
    return this.request(MELODY_BASE_URL, "POST", "removeTrackFromPool", {
      lobby_id: lobbyId,
      track_id: trackId,
    });
  }

  async listTrackPool(lobbyId) {
    return this.request(MELODY_BASE_URL, "GET", "listTrackPool", {
      lobby_id: lobbyId,
    });
  }

  async startRound(lobbyId, trackId = null) {
    return this.request(MELODY_BASE_URL, "POST", "startRound", {
      lobby_id: lobbyId,
      track_id: trackId,
    });
  }

  async revealRound(lobbyId) {
    return this.request(MELODY_BASE_URL, "POST", "revealRound", {
      lobby_id: lobbyId,
    });
  }

  async finishRound(lobbyId) {
    return this.request(MELODY_BASE_URL, "POST", "finishRound", {
      lobby_id: lobbyId,
    });
  }

  async submitAnswer(lobbyId, guessTitle, guessArtist) {
    return this.request(MELODY_BASE_URL, "POST", "submitAnswer", {
      lobby_id: lobbyId,
      guess_title: guessTitle,
      guess_artist: guessArtist,
    });
  }

  async getRoundState(lobbyId) {
    return this.request(MELODY_BASE_URL, "GET", "getRoundState", {
      lobby_id: lobbyId,
    });
  }

  async getScoreboard(lobbyId) {
    return this.request(MELODY_BASE_URL, "GET", "getScoreboard", {
      lobby_id: lobbyId,
    });
  }

  async listPublicLobbies() {
    return this.request(MELODY_BASE_URL, "GET", "listPublicLobbies");
  }

  async listCategories() {
    return this.request(MELODY_BASE_URL, "GET", "listCategories");
  }

  async listFamilies(categoryId = null) {
    const body = categoryId ? { category_id: categoryId } : null;
    return this.request(MELODY_BASE_URL, "GET", "listFamilies", body);
  }

  async listTracks(familyId = null) {
    const body = familyId ? { family_id: familyId } : null;
    return this.request(MELODY_BASE_URL, "GET", "listTracks", body);
  }

  async createCategory(data) {
    return this.request(MELODY_BASE_URL, "POST", "createCategory", data);
  }

  async createFamily(data) {
    return this.request(MELODY_BASE_URL, "POST", "createFamily", data);
  }

  async createTrack(data) {
    return this.request(MELODY_BASE_URL, "POST", "createTrack", data);
  }

  async updateCategory(data) {
    return this.request(MELODY_BASE_URL, "PUT", "updateCategory", data);
  }

  async updateFamily(data) {
    return this.request(MELODY_BASE_URL, "PUT", "updateFamily", data);
  }

  async updateTrack(data) {
    return this.request(MELODY_BASE_URL, "PUT", "updateTrack", data);
  }

  async deleteCategory(id) {
    return this.request(MELODY_BASE_URL, "DELETE", "deleteCategory", { id });
  }

  async deleteFamily(id) {
    return this.request(MELODY_BASE_URL, "DELETE", "deleteFamily", { id });
  }

  async deleteTrack(id) {
    return this.request(MELODY_BASE_URL, "DELETE", "deleteTrack", { id });
  }
}



