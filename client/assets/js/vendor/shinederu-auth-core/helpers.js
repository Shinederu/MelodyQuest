export const DEFAULT_ENDPOINTS = {
    login: "",
    register: "",
    me: "",
    logout: "",
    logoutAll: "",
    requestPasswordReset: "",
    resetPassword: "",
    requestEmailUpdate: "",
    confirmEmailUpdate: "",
    verifyEmail: "",
    revokeRegister: "",
    revokeEmailUpdate: "",
    updateProfile: "",
    updateAvatar: "",
    deleteAccount: "",
};
export const EMPTY_SESSION = {
    isAuthenticated: false,
    user: null,
    updatedAt: Date.now(),
};
export const mergeEndpoints = (custom) => ({
    ...DEFAULT_ENDPOINTS,
    ...(custom ?? {}),
});
export const toQueryString = (payload) => {
    const params = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null)
            return;
        if (Array.isArray(value)) {
            value.forEach((entry) => params.append(key, String(entry)));
            return;
        }
        params.append(key, String(value));
    });
    return params.toString();
};
export const defaultTransformUser = (payload) => {
    if (!payload || typeof payload !== "object")
        return null;
    const raw = payload;
    const fromData = raw.data && typeof raw.data === "object" ? raw.data : null;
    if (raw.user && typeof raw.user === "object") {
        return raw.user;
    }
    if (fromData?.user && typeof fromData.user === "object") {
        return fromData.user;
    }
    return null;
};
//# sourceMappingURL=helpers.js.map