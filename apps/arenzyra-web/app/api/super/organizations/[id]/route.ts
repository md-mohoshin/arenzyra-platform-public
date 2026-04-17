import { API_URL } from "@/lib/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = request.headers.get("authorization");

  const res = await fetch(`${API_URL}/super/organizations/${id}`, {
    headers: authorization ? { Authorization: authorization } : undefined,
  });

  const data = await res.json();

  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
