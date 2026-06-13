const axios = require("axios");
const fs = require("node:fs");
const path = require("node:path");
const {
  getDefaultProtocolForEnvironment,
  getProcessDefaultApiBase,
  resolveProcessApiEnvironment,
} = require("./apiBaseDefaults.cjs");

const UNAUTHORIZED_ERROR_CODE = "ARENZYRA_AUTH_UNAUTHORIZED";
const OBSERVER_LIMIT_ERROR_CODE = "OBSERVER_LIMIT_REACHED";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFRESH_PROMISE_CACHE_MS = 5000;

function defaultResolveApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return getProcessDefaultApiBase();
  }

  const defaultProtocol = getDefaultProtocolForEnvironment(
    resolveProcessApiEnvironment(),
  );

  try {
    return new URL(
      trimmed.includes("://") ? trimmed : `${defaultProtocol}//${trimmed}`,
    )
      .toString()
      .replace(/\/$/, "");
  } catch {
    return getProcessDefaultApiBase();
  }
}

function normalizeApiErrorMessage(error, fallback) {
  const responseData = error?.response?.data;
  if (Array.isArray(responseData?.message) && responseData.message.length > 0) {
    return responseData.message.map((item) => String(item)).join(", ");
  }
  if (
    typeof responseData?.message === "string" &&
    responseData.message.trim()
  ) {
    return responseData.message.trim();
  }
  if (typeof responseData?.error === "string" && responseData.error.trim()) {
    return responseData.error.trim();
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function unauthorizedError(message) {
  const error = new Error(message || UNAUTHORIZED_ERROR_CODE);
  error.code = UNAUTHORIZED_ERROR_CODE;
  return error;
}

function buildApiError(error, fallback) {
  const nextError = new Error(normalizeApiErrorMessage(error, fallback));
  const responseData = error?.response?.data;
  const responseStatus = Number(error?.response?.status);

  if (Number.isFinite(responseStatus)) {
    nextError.status = responseStatus;
  }

  if (typeof responseData?.error === "string" && responseData.error.trim()) {
    nextError.code = responseData.error.trim();
  }

  if (responseData?.license) {
    nextError.license = responseData.license;
  }

  if (Number.isFinite(responseData?.activeSessions)) {
    nextError.activeSessions = Number(responseData.activeSessions);
  }

  if (Number.isFinite(responseData?.maxObservers)) {
    nextError.maxObservers = Number(responseData.maxObservers);
  }

  if (
    typeof responseData?.machineId === "string" &&
    responseData.machineId.trim()
  ) {
    nextError.machineId = responseData.machineId.trim();
  }

  return nextError;
}

function screenshotMimeType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

function createScreenshotUploadForm(filePath) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    throw new Error("Screenshot file path is required.");
  }
  if (!fs.existsSync(normalizedPath)) {
    throw new Error("Screenshot file was not found.");
  }
  if (typeof FormData !== "function" || typeof Blob !== "function") {
    throw new Error("This launcher runtime cannot create screenshot uploads.");
  }

  const buffer = fs.readFileSync(normalizedPath);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Screenshot file is empty.");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: screenshotMimeType(normalizedPath) }),
    path.basename(normalizedPath) || "visual-capture.png",
  );
  return form;
}

function normalizeLoginParams(params) {
  const email = String(params?.email || "")
    .trim()
    .toLowerCase();
  const password = String(params?.password || "");

  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  if (!password.trim()) {
    throw new Error("Enter your password.");
  }

  return { email, password };
}

function parseToken(payload, primaryKey, fallbackKey) {
  if (typeof payload?.[primaryKey] === "string" && payload[primaryKey].trim()) {
    return payload[primaryKey].trim();
  }

  if (typeof fallbackKey === "string") {
    const fallback = payload?.[fallbackKey];
    if (typeof fallback === "string" && fallback.trim()) {
      return fallback.trim();
    }
  }

  return "";
}

function parseAuthBundle(payload, apiBase) {
  const accessToken = parseToken(payload, "access_token", "accessToken");
  const refreshToken = parseToken(payload, "refresh_token", "refreshToken");

  if (!accessToken) {
    throw new Error("Auth response did not include an access token.");
  }

  if (!refreshToken) {
    throw new Error("Auth response did not include a refresh token.");
  }

  return {
    apiBase,
    accessToken,
    refreshToken,
    user: payload?.user ?? null,
    organization: payload?.organization ?? null,
  };
}

function createLauncherApiClient(options) {
  const resolveApiBase =
    typeof options?.resolveApiBase === "function"
      ? options.resolveApiBase
      : typeof options?.normalizeBaseUrl === "function"
        ? options.normalizeBaseUrl
        : defaultResolveApiBase;
  const getSession =
    typeof options?.getSession === "function" ? options.getSession : null;
  const onSessionUpdate =
    typeof options?.onSessionUpdate === "function"
      ? options.onSessionUpdate
      : async () => {};
  const onActivity =
    typeof options?.onActivity === "function"
      ? options.onActivity
      : async () => {};
  const onUnauthorized =
    typeof options?.onUnauthorized === "function"
      ? options.onUnauthorized
      : async () => {};
  const refreshPromises = new Map();

  function buildRefreshKey(apiBase, refreshToken) {
    return `${apiBase}\n${refreshToken}`;
  }

  function readCurrentAuthBundle(apiBase, staleRefreshToken) {
    if (!getSession) {
      return null;
    }

    let session = null;
    try {
      session = getSession();
    } catch {
      return null;
    }

    const accessToken = String(
      session?.accessToken || session?.token || "",
    ).trim();
    const refreshToken = String(session?.refreshToken || "").trim();

    if (!accessToken || !refreshToken || refreshToken === staleRefreshToken) {
      return null;
    }

    return {
      apiBase,
      accessToken,
      refreshToken,
      user: session?.user ?? null,
      organization: session?.organization ?? null,
    };
  }

  async function performRequest(config, token) {
    return axios({
      method: config?.method || "GET",
      url: `${config.baseUrl}${config.path}`,
      data: config?.data,
      params: config?.params,
      timeout: config?.timeout ?? 15000,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(config?.headers || {}),
      },
    });
  }

  async function refreshSessionDirect(params) {
    const normalizedBase = resolveApiBase(params?.apiBase);
    const refreshToken = String(params?.refreshToken || "").trim();

    if (!refreshToken) {
      throw unauthorizedError();
    }

    try {
      const response = await axios.post(
        `${normalizedBase}/auth/refresh`,
        {
          refreshToken,
        },
        {
          timeout: 15000,
          headers: {
            Accept: "application/json",
          },
        },
      );

      return parseAuthBundle(response?.data ?? {}, normalizedBase);
    } catch (error) {
      if (error?.response?.status === 401) {
        throw unauthorizedError();
      }
      throw buildApiError(error, "Session refresh failed.");
    }
  }

  async function refreshSession(params) {
    const normalizedBase = resolveApiBase(params?.apiBase);
    const refreshToken = String(params?.refreshToken || "").trim();

    if (!refreshToken) {
      throw unauthorizedError();
    }

    const currentBundle = readCurrentAuthBundle(normalizedBase, refreshToken);
    if (currentBundle) {
      return currentBundle;
    }

    const refreshKey = buildRefreshKey(normalizedBase, refreshToken);
    const existingRefresh = refreshPromises.get(refreshKey);
    if (existingRefresh) {
      return existingRefresh;
    }

    const refreshPromise = refreshSessionDirect({
      apiBase: normalizedBase,
      refreshToken,
    });

    refreshPromise.then(
      () => {
        const cleanupTimer = setTimeout(() => {
          if (refreshPromises.get(refreshKey) === refreshPromise) {
            refreshPromises.delete(refreshKey);
          }
        }, REFRESH_PROMISE_CACHE_MS);
        if (typeof cleanupTimer.unref === "function") {
          cleanupTimer.unref();
        }
      },
      () => {
        if (refreshPromises.get(refreshKey) === refreshPromise) {
          refreshPromises.delete(refreshKey);
        }
      },
    );

    refreshPromises.set(refreshKey, refreshPromise);
    return refreshPromise;
  }

  async function request(config) {
    const normalizedBase = resolveApiBase(config?.apiBase);
    let accessToken = String(config?.token || config?.accessToken || "").trim();
    let refreshToken = String(config?.refreshToken || "").trim();
    const path = String(config?.path || "").trim();
    const method = String(config?.method || "GET")
      .trim()
      .toUpperCase();

    const updateSession = async (bundle) => {
      accessToken = bundle.accessToken;
      refreshToken = bundle.refreshToken;
      await onSessionUpdate({
        apiBase: normalizedBase,
        token: bundle.accessToken,
        accessToken: bundle.accessToken,
        refreshToken: bundle.refreshToken,
        user: bundle.user ?? config?.user ?? null,
        organization: bundle.organization ?? config?.organization ?? null,
      });
    };

    const recordActivity = async () => {
      if (config?.recordActivity === false) {
        return;
      }

      try {
        await onActivity({
          apiBase: normalizedBase,
          path,
          method,
        });
      } catch {
        // Activity persistence must never break successful API responses.
      }
    };

    if (!accessToken && refreshToken && config?.allowRefresh !== false) {
      try {
        const refreshed = await refreshSession({
          apiBase: normalizedBase,
          refreshToken,
        });
        await updateSession(refreshed);
      } catch (error) {
        if (error?.code === UNAUTHORIZED_ERROR_CODE) {
          await onUnauthorized({
            apiBase: normalizedBase,
            path,
            method,
            accessToken,
            refreshToken,
          });
          throw unauthorizedError();
        }
        throw error;
      }
    }

    if (!accessToken) {
      await onUnauthorized({
        apiBase: normalizedBase,
        path,
        method,
        accessToken,
        refreshToken,
      });
      throw unauthorizedError();
    }

    try {
      const response = await performRequest(
        {
          ...config,
          baseUrl: normalizedBase,
          path,
        },
        accessToken,
      );
      await recordActivity();
      return response?.data;
    } catch (error) {
      if (error?.response?.status === 401) {
        if (refreshToken && config?.allowRefresh !== false) {
          try {
            const refreshed = await refreshSession({
              apiBase: normalizedBase,
              refreshToken,
            });
            await updateSession(refreshed);
            const retryResponse = await performRequest(
              {
                ...config,
                baseUrl: normalizedBase,
                path,
              },
              accessToken,
            );
            await recordActivity();
            return retryResponse?.data;
          } catch (refreshError) {
            if (refreshError?.code === UNAUTHORIZED_ERROR_CODE) {
              await onUnauthorized({
                apiBase: normalizedBase,
                path,
                method,
                accessToken,
                refreshToken,
              });
              throw unauthorizedError();
            }
            throw refreshError;
          }
        }

        await onUnauthorized({
          apiBase: normalizedBase,
          path,
          method,
          accessToken,
          refreshToken,
        });
        throw unauthorizedError();
      }
      throw buildApiError(error, `Request failed for ${path || "API call"}.`);
    }
  }

  return {
    async login(params) {
      const normalizedBase = resolveApiBase(params?.apiBase);
      const credentials = normalizeLoginParams(params);

      try {
        const response = await axios.post(
          `${normalizedBase}/auth/login`,
          {
            email: credentials.email,
            password: credentials.password,
          },
          {
            timeout: 15000,
            headers: {
              Accept: "application/json",
            },
          },
        );

        return parseAuthBundle(response?.data ?? {}, normalizedBase);
      } catch (error) {
        if (error?.response?.status === 401) {
          throw unauthorizedError("Invalid email or password.");
        }
        throw buildApiError(error, "Login failed.");
      }
    },

    async restoreSession(params) {
      const normalizedBase = resolveApiBase(params?.apiBase);
      const refreshToken = String(params?.refreshToken || "").trim();

      if (refreshToken) {
        return refreshSession({
          apiBase: normalizedBase,
          refreshToken,
        });
      }

      const payload = await request({
        apiBase: normalizedBase,
        token: params?.token,
        path: "/auth/me",
        method: "GET",
        timeout: 10000,
        allowRefresh: false,
      });

      return {
        apiBase: normalizedBase,
        accessToken: String(params?.token || "").trim(),
        refreshToken: "",
        user: payload?.user ?? null,
        organization: payload?.organization ?? null,
      };
    },

    async logout(params) {
      const normalizedBase = resolveApiBase(params?.apiBase);
      const refreshToken = String(params?.refreshToken || "").trim();

      if (!refreshToken) {
        return { ok: true };
      }

      try {
        const response = await axios.post(
          `${normalizedBase}/auth/logout`,
          {
            refreshToken,
          },
          {
            timeout: 10000,
            headers: {
              Accept: "application/json",
            },
          },
        );
        return response?.data ?? { ok: true };
      } catch (error) {
        if (error?.response?.status === 401) {
          return { ok: true };
        }
        throw buildApiError(error, "Logout failed.");
      }
    },

    async listTournaments(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/me/tournaments",
      });
    },

    async listStages(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: `/me/tournaments/${encodeURIComponent(
          String(params?.tournamentId || ""),
        )}/stages`,
      });
    },

    async listMatches(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: `/me/tournaments/${encodeURIComponent(
          String(params?.tournamentId || ""),
        )}/matches`,
      });
    },

    async getActiveMatch(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/me/active-match",
      });
    },

    async fetchObserverSlots(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: `/api/observer/match/${encodeURIComponent(
          String(params?.matchId || ""),
        )}/slots`,
      });
    },

    async fetchTeamPlayers(params) {
      const teamId = String(params?.teamId || "").trim();
      const organizationId = String(params?.organizationId || "").trim();
      const attempts = [
        `/me/teams/${encodeURIComponent(teamId)}/players`,
        `/organizer/teams/${encodeURIComponent(teamId)}/players`,
        organizationId
          ? `/org/${encodeURIComponent(organizationId)}/teams/${encodeURIComponent(
              teamId,
            )}/roster`
          : null,
      ].filter(Boolean);

      let lastError = null;
      for (const path of attempts) {
        try {
          return await request({
            apiBase: params?.apiBase,
            token: params?.token,
            refreshToken: params?.refreshToken,
            path,
          });
        } catch (error) {
          lastError = error;
          const status = Number(error?.status);
          if (![400, 403, 404].includes(status)) {
            throw error;
          }
        }
      }

      throw lastError || new Error("Team players could not be loaded.");
    },

    async syncSlotsFromPreviousMatch(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: `/me/matches/${encodeURIComponent(
          String(params?.matchId || ""),
        )}/slots/sync-previous`,
        method: "POST",
        data: {
          overwrite: params?.overwrite === true,
          dryRun: params?.dryRun === true,
        },
      });
    },

    async generateShadowBranding(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: `/api/observer/match/${encodeURIComponent(
          String(params?.matchId || ""),
        )}/shadow-branding`,
        method: "POST",
      });
    },

    async getNextMatchSuggestion(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: `/api/observer/match/${encodeURIComponent(
          String(params?.matchId || ""),
        )}/next`,
        params: {
          ...(typeof params?.suggestedMatchId === "string" &&
          params.suggestedMatchId.trim()
            ? { suggestedMatchId: params.suggestedMatchId.trim() }
            : {}),
        },
      });
    },

    async startMatchControl(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: `/me/matches/${encodeURIComponent(
          String(params?.matchId || ""),
        )}/control/start`,
        method: "POST",
        data: {
          sessionId:
            typeof params?.sessionId === "string"
              ? params.sessionId
              : undefined,
          source:
            typeof params?.source === "string" ? params.source : undefined,
          clientId:
            typeof params?.clientId === "string" ? params.clientId : undefined,
          requestedMatchId:
            typeof params?.requestedMatchId === "string"
              ? params.requestedMatchId
              : undefined,
        },
      });
    },

    async getMatchControl(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: `/me/matches/${encodeURIComponent(
          String(params?.matchId || ""),
        )}/control`,
      });
    },

    async getLauncherLicense(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/launcher/license",
      });
    },

    async getAiCasterAccess(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/api/ai-caster/access",
        params: {
          ...(typeof params?.organizationId === "string" &&
          params.organizationId.trim()
            ? { organizationId: params.organizationId.trim() }
            : {}),
        },
      });
    },

    async updateAiCasterSettings(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/api/ai-caster/settings",
        method: "PATCH",
        params: {
          ...(typeof params?.organizationId === "string" &&
          params.organizationId.trim()
            ? { organizationId: params.organizationId.trim() }
            : {}),
        },
        data: params?.settings || {},
      });
    },

    async previewAiCasterVoice(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/api/ai-caster/voice-preview",
        method: "POST",
        params: {
          ...(typeof params?.organizationId === "string" &&
          params.organizationId.trim()
            ? { organizationId: params.organizationId.trim() }
            : {}),
        },
        data: params?.preview || {},
        timeout: 45000,
      });
    },

    async startLauncherSession(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/launcher/session/start",
        method: "POST",
        data: {
          machineId: params?.machineId,
        },
      });
    },

    async endLauncherSession(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/launcher/session/end",
        method: "POST",
        data: {
          machineId: params?.machineId,
        },
      });
    },

    async createObserverFeedToken(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/launcher/observer-feed-token",
        method: "POST",
      });
    },

    async uploadScreenshot(params) {
      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/ingest/screenshot/upload",
        method: "POST",
        data: createScreenshotUploadForm(params?.filePath),
        timeout: 60000,
      });
    },

    async previewScreenshotResults(params) {
      const matchId = String(params?.matchId || "").trim();
      const imageUrl = String(params?.imageUrl || "").trim();
      const imageUrls = Array.isArray(params?.imageUrls)
        ? params.imageUrls
            .map((url) => String(url || "").trim())
            .filter(Boolean)
        : [];
      if (!matchId) {
        throw new Error("Match id is required for OCR preview.");
      }
      const urls = imageUrls.length ? imageUrls : imageUrl ? [imageUrl] : [];
      if (!urls.length) {
        throw new Error("Screenshot URL is required for OCR preview.");
      }

      return request({
        apiBase: params?.apiBase,
        token: params?.token,
        refreshToken: params?.refreshToken,
        path: "/ingest/screenshot",
        method: "POST",
        data: {
          matchId,
          imageUrls: urls,
        },
        timeout: 120000,
      });
    },
  };
}

module.exports = {
  createLauncherApiClient,
  OBSERVER_LIMIT_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
};
