// Test-only preload. It is never imported by application code or a Vercel deployment.
if (process.env.POCKET_BASE_E2E_MODEL === "true") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== "https://openrouter.ai/api/v1/chat/completions") return originalFetch(input, init);
    const body = JSON.parse(String(init.body));
    const prompt = body.messages.at(-1).content;
    if (prompt.includes("busy model")) return new Response("Fictional upstream capacity error", { status: 429 });
    const updated = body.messages.length > 2;
    const color = updated ? "#b49bdf" : "#9ed9c7";
    const html = '<!doctype html><html><head><style>body{margin:0;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:' + color +
      ';font:18px system-ui;color:#30213f}button{font:inherit;padding:20px;border:0;border-radius:20px;background:#faf8f2;touch-action:manipulation}</style></head><body><h1>Moon Bubbles</h1><button id="pop">' +
      (updated ? "Pop a rainbow bubble" : "Pop a moon bubble") + '</button><p id="score">Popped 0</p><script>let score=0;document.getElementById("pop").onclick=()=>{score++;document.getElementById("score").textContent="Popped "+score;};</script></body></html>';
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      title: "Moon Bubbles", description: updated ? "A fictional updated game for browser testing." : "A fictional first game for browser testing.", theme: updated ? "lilac" : "mint", html,
    }) } }] });
  };
}
