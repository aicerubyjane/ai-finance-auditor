// Forwards /api/* requests to the FastAPI backend hosted outside Netlify.
// Set BACKEND_URL (e.g. https://ai-finance-auditor-production.up.railway.app)
// in Netlify environment variables.
export default async (req: Request) => {
  const backend = Netlify.env.get("BACKEND_URL");
  if (!backend) {
    return Response.json(
      { detail: "BACKEND_URL belum diatur di environment variables Netlify." },
      { status: 503 },
    );
  }

  const incoming = new URL(req.url);
  const target = new URL(incoming.pathname + incoming.search, backend.replace(/\/+$/, "") + "/");

  const headers = new Headers(req.headers);
  headers.delete("host");

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
    });
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (err) {
    return Response.json(
      { detail: `Backend tidak bisa dihubungi: ${(err as Error).message}` },
      { status: 502 },
    );
  }
};

export const config = {
  path: "/api/*",
};
