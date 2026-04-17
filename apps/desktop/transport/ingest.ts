import axios from "axios";

export async function sendEvents(
  apiBaseUrl: string,
  token: string,
  events: any[]
) {
  await axios.post(
    `${apiBaseUrl.replace(/\/$/, "")}/ingest/batch`,
    { events },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
}