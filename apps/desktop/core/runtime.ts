import { sendEvents } from "../transport/ingest";

export async function runOnce(params: {
  apiBaseUrl: string;
  token: string;
  events: any[];
}) {
  await sendEvents(params.apiBaseUrl, params.token, params.events);
}