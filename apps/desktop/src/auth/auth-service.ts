import { launcherApi } from "../api/api-client";

export const authService = {
  bootstrap: launcherApi.bootstrap,
  login: launcherApi.login,
  logout: launcherApi.logout,
};
