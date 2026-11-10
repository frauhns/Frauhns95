// POSTS FROM KV
export async function onRequest(context) {
  try {
    const raw = await context.env.F95_KV.get("posts");
    return new Response(raw || "[]", { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
