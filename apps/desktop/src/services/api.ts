import axios from "axios";
import crypto from "node:crypto";
import { DEFAULT_RENDERER_API_BASE } from "../default-api-base";

export const defaultBase = DEFAULT_RENDERER_API_BASE;

export function makeClient(token: string, clientId?: string, baseUrl?: string) {
  const cid = clientId || `pcob-${crypto.randomUUID()}`;
  const base = (baseUrl || defaultBase).replace(/\/$/, "") || defaultBase;
  return axios.create({
    baseURL: base,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-client-id": cid,
    },
  });
}
