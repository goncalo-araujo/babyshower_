// =============================================================
// Baby Shower Worker — Single entry point
// Handles all API routes, D1 database operations, and AI chat
// =============================================================

interface Env {
  DB: D1Database;
  AI: Ai;
  ADMIN_PASSWORD: string;
  GUEST_PASSWORD: string;
  FRONTEND_ORIGIN: string;
}

interface Item {
  id: number;
  title: string;
  description: string;
  image_url: string;
  product_url: string;
  price_total: number;
  price_raised: number;
  is_funded: number;
  created_at: string;
}

interface Contribution {
  id: number;
  item_id: number;
  contributor_name: string;
  contributor_ip: string | null;
  amount: number;
  message: string;
  created_at: string;
  item_title?: string;
}

// =============================================================
// Constants
// =============================================================

const CHAT_DAILY_LIMIT = 3;        // max messages per IP per day
const MAX_MESSAGE_LENGTH = 300;    // chars — matches frontend maxlength
const MAX_NAME_LENGTH = 100;
const MAX_GENERIC_STRING = 500;

// =============================================================
// Helpers
// =============================================================

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, X-Guest-Password",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

function isAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get("X-Admin-Password");
  return header !== null && header === env.ADMIN_PASSWORD;
}

function isGuest(request: Request, env: Env): boolean {
  const header = request.headers.get("X-Guest-Password");
  return header !== null && header === env.GUEST_PASSWORD;
}

function extractId(pathname: string): number {
  const parts = pathname.split("/");
  return parseInt(parts[parts.length - 1], 10);
}

/** Strip control characters and hard-cap length. */
function sanitise(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, maxLen);
}

/** Return today's ISO date string in UTC: '2025-04-12' */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get caller IP from CF headers. */
function getIP(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ??
    "unknown"
  );
}

// =============================================================
// Route Handlers
// =============================================================

const GENERIC_DONATION_TITLE = "Doação Geral para Mobilía/Obras";

async function handleGetItems(env: Env, origin: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM items ORDER BY
      CASE WHEN title = '${GENERIC_DONATION_TITLE}' THEN 1 ELSE 0 END ASC,
      is_funded ASC,
      created_at ASC`
  ).all<Item>();
  return jsonResponse(results, 200, origin);
}

async function handleCreateItem(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  const body = (await request.json()) as Partial<Item>;
  const title = sanitise(body.title, MAX_GENERIC_STRING);
  if (!title) {
    return jsonResponse({ error: "title is required" }, 400, origin);
  }
  if (body.price_total === undefined || body.price_total < 0) {
    return jsonResponse({ error: "price_total must be >= 0" }, 400, origin);
  }
  const result = await env.DB.prepare(
    `INSERT INTO items (title, description, image_url, product_url, price_total)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      title,
      sanitise(body.description, MAX_GENERIC_STRING),
      sanitise(body.image_url, MAX_GENERIC_STRING),
      sanitise(body.product_url, MAX_GENERIC_STRING),
      Number(body.price_total)
    )
    .run();
  return jsonResponse({ id: result.meta.last_row_id }, 201, origin);
}

async function handleUpdateItem(
  request: Request,
  env: Env,
  origin: string,
  id: number
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  if (isNaN(id)) return jsonResponse({ error: "Invalid ID" }, 400, origin);

  const body = (await request.json()) as Partial<Item>;
  const title = sanitise(body.title, MAX_GENERIC_STRING);
  if (!title) {
    return jsonResponse({ error: "title is required" }, 400, origin);
  }

  const existing = await env.DB.prepare("SELECT * FROM items WHERE id=?")
    .bind(id)
    .first<Item>();
  if (!existing) return jsonResponse({ error: "Item not found" }, 404, origin);

  await env.DB.prepare(
    `UPDATE items SET
       title=?, description=?, image_url=?, product_url=?,
       price_total=?, is_funded=?
     WHERE id=?`
  )
    .bind(
      title,
      sanitise(body.description, MAX_GENERIC_STRING) || existing.description,
      sanitise(body.image_url, MAX_GENERIC_STRING) || existing.image_url,
      sanitise(body.product_url, MAX_GENERIC_STRING) || existing.product_url,
      body.price_total !== undefined ? Number(body.price_total) : existing.price_total,
      body.is_funded !== undefined ? Number(body.is_funded) : existing.is_funded,
      id
    )
    .run();

  return jsonResponse({ success: true }, 200, origin);
}

async function handleDeleteItem(
  request: Request,
  env: Env,
  origin: string,
  id: number
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  if (isNaN(id)) return jsonResponse({ error: "Invalid ID" }, 400, origin);

  await env.DB.prepare("DELETE FROM items WHERE id=?").bind(id).run();
  return jsonResponse({ success: true }, 200, origin);
}

async function handleGetContributions(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  const { results } = await env.DB.prepare(
    `SELECT c.*, i.title as item_title
     FROM contributions c
     JOIN items i ON c.item_id = i.id
     ORDER BY c.created_at DESC`
  ).all<Contribution>();
  return jsonResponse(results, 200, origin);
}

async function handleCreateContribution(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  if (!isGuest(request, env) && !isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const body = (await request.json()) as {
    item_id: number;
    contributor_name: string;
    amount: number;
    message?: string;
  };

  const itemId = parseInt(String(body.item_id), 10);
  if (!itemId || isNaN(itemId)) {
    return jsonResponse({ error: "item_id is required" }, 400, origin);
  }
  const name = sanitise(body.contributor_name, MAX_NAME_LENGTH);
  if (!name) {
    return jsonResponse({ error: "contributor_name is required" }, 400, origin);
  }
  const amount = Number(body.amount);
  if (!amount || amount <= 0 || !isFinite(amount)) {
    return jsonResponse({ error: "amount must be > 0" }, 400, origin);
  }

  const item = await env.DB.prepare("SELECT * FROM items WHERE id=?")
    .bind(itemId)
    .first<Item>();
  if (!item) return jsonResponse({ error: "Item not found" }, 404, origin);
  if (item.is_funded === 1) {
    return jsonResponse({ error: "This item is already fully funded" }, 409, origin);
  }

  const remaining = item.price_total - item.price_raised;
  const appliedAmount = Math.min(amount, remaining);
  const newRaised = item.price_raised + appliedAmount;
  const isFunded = newRaised >= item.price_total ? 1 : 0;
  const contributorIp = getIP(request);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO contributions (item_id, contributor_name, amount, message, contributor_ip)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      itemId,
      name,
      appliedAmount,
      sanitise(body.message, MAX_MESSAGE_LENGTH),
      contributorIp
    ),
    env.DB.prepare(
      `UPDATE items SET price_raised=?, is_funded=? WHERE id=?`
    ).bind(newRaised, isFunded, itemId),
  ]);

  return jsonResponse(
    {
      success: true,
      applied_amount: appliedAmount,
      new_raised: newRaised,
      is_funded: isFunded === 1,
    },
    201,
    origin
  );
}

async function handleGetMyContributions(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  if (!isGuest(request, env) && !isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  const ip = getIP(request);
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.item_id, c.contributor_name, c.amount, c.message, c.created_at,
            i.title AS item_title
     FROM contributions c
     JOIN items i ON c.item_id = i.id
     WHERE c.contributor_ip = ?
     ORDER BY c.created_at DESC`
  ).bind(ip).all<Contribution>();
  return jsonResponse(results, 200, origin);
}

async function handleDeleteMyContribution(
  request: Request,
  env: Env,
  origin: string,
  id: number
): Promise<Response> {
  if (!isGuest(request, env) && !isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  const ip = getIP(request);
  const contribution = await env.DB.prepare(
    "SELECT id, item_id, amount FROM contributions WHERE id=? AND contributor_ip=?"
  ).bind(id, ip).first<{ id: number; item_id: number; amount: number }>();
  if (!contribution) {
    return jsonResponse({ error: "Não encontrado" }, 404, origin);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM contributions WHERE id=?").bind(id),
    env.DB.prepare(
      `UPDATE items SET
         price_raised = MAX(0, price_raised - ?),
         is_funded = 0
       WHERE id=?`
    ).bind(contribution.amount, contribution.item_id),
  ]);
  return jsonResponse({ success: true }, 200, origin);
}

async function handleChat(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  if (!isGuest(request, env) && !isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const body = (await request.json()) as {
    message?: string;
    history?: Array<{ role: string; content: string }>;
  };
  const message = sanitise(body.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    return jsonResponse({ error: "message is required" }, 400, origin);
  }

  // --- Rate limiting: disabled for testing, re-enable before sharing ---
  // const ip = getIP(request);
  // const day = todayUTC();

  // const row = await env.DB.prepare(
  //   "SELECT count FROM chat_rate_limit WHERE ip=? AND day=?"
  // ).bind(ip, day).first<{ count: number }>();

  // const currentCount = row?.count ?? 0;
  // if (currentCount >= CHAT_DAILY_LIMIT) {
  //   return jsonResponse(
  //     { error: "Limite diário de mensagens atingido. Tenta novamente amanhã." },
  //     429,
  //     origin
  //   );
  // }

  // await env.DB.prepare(
  //   `INSERT INTO chat_rate_limit (ip, day, count) VALUES (?, ?, 1)
  //    ON CONFLICT(ip, day) DO UPDATE SET count = count + 1`
  // ).bind(ip, day).run();

  const ip = getIP(request);

  // Fetch current gift state for AI context
  const { results: items } = await env.DB.prepare(
    `SELECT id, title, description, price_total, price_raised, is_funded, product_url
     FROM items ORDER BY
       CASE WHEN title = '${GENERIC_DONATION_TITLE}' THEN 1 ELSE 0 END ASC,
       is_funded ASC, created_at ASC`
  ).all<Item>();

  // Fetch this guest's own contributions for AI context
  const { results: myContributions } = await env.DB.prepare(
    `SELECT c.id, c.item_id, c.contributor_name, c.amount, c.message,
            i.title AS item_title
     FROM contributions c
     JOIN items i ON c.item_id = i.id
     WHERE c.contributor_ip = ?
     ORDER BY c.created_at DESC`
  ).bind(ip).all<Contribution>();

  const giftContext =
    items.length > 0
      ? items
          .map((item) => {
            const status = item.is_funded ? "fully funded" : `€${Number(item.price_raised).toFixed(2)} raised of €${Number(item.price_total).toFixed(2)}`;
            return `- [ID:${item.id}] ${item.title}: ${item.description} | Price: €${Number(item.price_total).toFixed(2)} | Status: ${status}`;
          })
          .join("\n")
      : "No gift items have been added yet.";

  const myContribsContext =
    myContributions.length > 0
      ? myContributions
          .map((c) => `- [ContribID:${c.id}] €${Number(c.amount).toFixed(2)} for "${c.item_title}"${c.message ? ` (message: "${c.message}")` : ""}`)
          .join("\n")
      : "This guest has no registered contributions yet.";

  const systemPrompt = `You are a warm and friendly assistant for the baby shower of Maria Luísa.
Your role is to help guests with anything related to the event, the family, the baby, the gift registry, and how to contribute.

THE FAMILY:
- Parents: Gonçalo and Inês
- Baby's name: Maria Luísa
- Gender: Girl 👧
- Due date: 14 June 2026

THE NURSERY:
- Theme: Safari
- Colours: green, white, beige, and brown
- Think earthy tones, animals, nature — a cosy safari adventure nursery

EVENT DETAILS:
- Name: Baby Shower da Maria Luísa
- Date: Saturday, 11 April 2026
- Time: 15h00 – 19h00
- Venue: Messe Militar de Évora, Évora, Portugal
- Google Maps: https://maps.google.com?q=Messe+Militar+de+%C3%89vora,+%C3%89vora,+Portugal
- Directions: Guests should use Google Maps or Waze with "Messe Militar de Évora" as the destination.
- Parking: Yes — there is parking available inside the Messe Militar de Évora grounds.
- Food: Yes — there will be a traditional Portuguese "lanche" (afternoon snacks/tea).

GIFT REGISTRY:
${giftContext}

THIS GUEST'S CONTRIBUTIONS:
${myContribsContext}

CONTRIBUTION FLOW:
If a guest wants to contribute to a gift via this chat, collect in a friendly conversation:
1. Which gift they want (refer to names, not IDs)
2. Their full name
3. The amount in euros (minimum €1)
4. Optionally a personal message (they can skip)
Once you have item + name + amount, give a warm summary and tell the guest a confirmation card will appear.

CANCELLATION FLOW:
If a guest wants to cancel or change one of their existing contributions (listed above under THIS GUEST'S CONTRIBUTIONS):
1. Confirm which contribution they want to cancel (use the ContribID internally, refer to it by gift name and amount to the guest)
2. Give a brief summary and tell them a confirmation card will appear to cancel it.

Guidelines:
- Be warm, brief, and helpful. Keep responses under 120 words.
- IMPORTANT: Always respond in European Portuguese (Portugal). Use "autocarro" not "ônibus", "telemóvel" not "celular", "casa de banho" not "banheiro", etc.
- Answer questions about the event, the family, the baby, the nursery theme, etc.
- When asked for gift recommendations, prioritise items that are NOT yet fully funded.
- Do not discuss topics unrelated to the baby shower, the family, or the gift registry.
- Always respond in European Portuguese (Portugal). This is mandatory.`;

  // Build message history (last 10 turns to stay within token limits)
  const history = (body.history ?? []).slice(-10);
  const aiMessages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: message },
  ];

  const aiResponse = await env.AI.run(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as Parameters<typeof env.AI.run>[0],
    {
      messages: aiMessages,
      max_tokens: 350,
    }
  );

  const rawReply =
    (aiResponse as { response?: string }).response ??
    "Estou com dificuldades em responder agora. Por favor tenta novamente!";

  // Strip any accidental marker the main AI may emit anyway
  const reply = rawReply.replace(/\[CONTRIBUTION:[^\]]*\]/gs, "").trim();

  // --- Second AI call: structured extraction ---
  // Ask a separate focused call to extract contribution data from the full conversation.
  // This is far more reliable than asking the conversational AI to emit a JSON marker.
  const fullConversationText = [
    ...history.map((m) => `${m.role === "user" ? "Convidado" : "Assistente"}: ${m.content}`),
    `Convidado: ${message}`,
    `Assistente: ${reply}`,
  ].join("\n");

  const itemList = items.map((i) => `${i.id}: ${i.title}`).join("\n");
  const contribList = myContributions.length > 0
    ? myContributions.map((c) => `${c.id}: €${Number(c.amount).toFixed(2)} for "${c.item_title}"`).join("\n")
    : "none";

  const extractorMessages = [
    {
      role: "system" as const,
      content: `You detect guest actions from a conversation. Respond ONLY with valid JSON on one line, or the word null.

Available gift IDs:
${itemList}

This guest's contribution IDs:
${contribList}

Rules — output exactly ONE of these formats or null:

1. Guest wants to ADD a new contribution and has provided gift + name + amount:
{"action":"contribute","item_id":<number>,"name":"<string>","amount":<number>,"message":"<string>"}

2. Guest wants to CANCEL one of their existing contributions and has confirmed which one:
{"action":"cancel","contribution_id":<number>,"item_title":"<string>","amount":<number>}

3. Anything else (still collecting info, just chatting, asking questions):
null

Use "" for missing message. Never invent IDs. Output only the JSON or null.`,
    },
    {
      role: "user" as const,
      content: fullConversationText,
    },
  ];

  const extractorResponse = await env.AI.run(
    "@cf/meta/llama-3-8b-instruct" as Parameters<typeof env.AI.run>[0],
    { messages: extractorMessages, max_tokens: 100 }
  );

  const extractorRaw =
    (extractorResponse as { response?: string }).response ?? "null";

  let contributionPending: {
    item_id: number;
    item_title: string;
    name: string;
    amount: number;
    message: string;
  } | null = null;

  let cancellationPending: {
    contribution_id: number;
    item_title: string;
    amount: number;
  } | null = null;

  try {
    const jsonMatch = extractorRaw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]) as {
        action?: string;
        item_id?: number;
        name?: string;
        amount?: number;
        message?: string;
        contribution_id?: number;
        item_title?: string;
      };

      if (data.action === "contribute") {
        const item = items.find((i) => i.id === Number(data.item_id));
        if (item && data.name && Number(data.amount) > 0 && !item.is_funded) {
          contributionPending = {
            item_id: item.id,
            item_title: item.title,
            name: String(data.name),
            amount: Number(data.amount),
            message: String(data.message ?? ""),
          };
        }
      } else if (data.action === "cancel") {
        const existing = myContributions.find((c) => c.id === Number(data.contribution_id));
        if (existing) {
          cancellationPending = {
            contribution_id: existing.id,
            item_title: existing.item_title ?? String(data.item_title ?? ""),
            amount: existing.amount,
          };
        }
      }
    }
  } catch {
    // ignore parse errors
  }

  return jsonResponse({ reply, contribution_pending: contributionPending, cancellation_pending: cancellationPending }, 200, origin);
}

async function handleAdminDeleteContribution(
  request: Request,
  env: Env,
  origin: string,
  id: number
): Promise<Response> {
  if (!isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  const contribution = await env.DB.prepare(
    "SELECT id, item_id, amount FROM contributions WHERE id=?"
  ).bind(id).first<{ id: number; item_id: number; amount: number }>();
  if (!contribution) {
    return jsonResponse({ error: "Not found" }, 404, origin);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM contributions WHERE id=?").bind(id),
    env.DB.prepare(
      `UPDATE items SET price_raised = MAX(0, price_raised - ?), is_funded = 0 WHERE id=?`
    ).bind(contribution.amount, contribution.item_id),
  ]);
  return jsonResponse({ success: true }, 200, origin);
}

async function handleAdminAuth(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    "SELECT count FROM chat_rate_limit WHERE ip=? AND day=?"
  ).bind(`admin:${ip}`, day).first<{ count: number }>();
  const attempts = row?.count ?? 0;
  if (attempts >= 10) {
    return jsonResponse({ error: "Too many attempts. Try again tomorrow." }, 429, origin);
  }
  const body = (await request.json()) as { password?: string };
  if (body.password === env.ADMIN_PASSWORD) {
    // Reset counter on success
    await env.DB.prepare(
      "DELETE FROM chat_rate_limit WHERE ip=? AND day=?"
    ).bind(`admin:${ip}`, day).run();
    return jsonResponse({ success: true }, 200, origin);
  }
  // Increment failed attempt counter
  await env.DB.prepare(
    "INSERT INTO chat_rate_limit (ip, day, count) VALUES (?, ?, 1) ON CONFLICT(ip, day) DO UPDATE SET count = count + 1"
  ).bind(`admin:${ip}`, day).run();
  return jsonResponse({ error: "Incorrect password" }, 401, origin);
}

async function handleGuestAuth(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    "SELECT count FROM chat_rate_limit WHERE ip=? AND day=?"
  ).bind(`guest:${ip}`, day).first<{ count: number }>();
  const attempts = row?.count ?? 0;
  if (attempts >= 10) {
    return jsonResponse({ error: "Too many attempts. Try again tomorrow." }, 429, origin);
  }
  const body = (await request.json()) as { password?: string };
  if (body.password === env.GUEST_PASSWORD) {
    await env.DB.prepare(
      "DELETE FROM chat_rate_limit WHERE ip=? AND day=?"
    ).bind(`guest:${ip}`, day).run();
    return jsonResponse({ success: true }, 200, origin);
  }
  await env.DB.prepare(
    "INSERT INTO chat_rate_limit (ip, day, count) VALUES (?, ?, 1) ON CONFLICT(ip, day) DO UPDATE SET count = count + 1"
  ).bind(`guest:${ip}`, day).run();
  return jsonResponse({ error: "Palavra-passe incorreta" }, 401, origin);
}

// =============================================================
// Main fetch handler
// =============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const origin = env.FRONTEND_ORIGIN ?? "*";

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      // --- Items (public read, admin write) ---
      if (method === "GET" && pathname === "/api/items") {
        return await handleGetItems(env, origin);
      }
      if (method === "POST" && pathname === "/api/items") {
        return await handleCreateItem(request, env, origin);
      }
      if (method === "PUT" && /^\/api\/items\/\d+$/.test(pathname)) {
        return await handleUpdateItem(request, env, origin, extractId(pathname));
      }
      if (method === "DELETE" && /^\/api\/items\/\d+$/.test(pathname)) {
        return await handleDeleteItem(request, env, origin, extractId(pathname));
      }

      // --- Contributions (guest/admin write, admin read) ---
      if (method === "GET" && pathname === "/api/contributions") {
        return await handleGetContributions(request, env, origin);
      }
      if (method === "POST" && pathname === "/api/contributions") {
        return await handleCreateContribution(request, env, origin);
      }
      if (method === "DELETE" && /^\/api\/contributions\/\d+$/.test(pathname)) {
        return await handleAdminDeleteContribution(request, env, origin, extractId(pathname));
      }
      if (method === "GET" && pathname === "/api/my-contributions") {
        return await handleGetMyContributions(request, env, origin);
      }
      if (method === "DELETE" && /^\/api\/my-contributions\/\d+$/.test(pathname)) {
        return await handleDeleteMyContribution(request, env, origin, extractId(pathname));
      }

      // --- Chat (guest/admin only, rate limited) ---
      if (method === "POST" && pathname === "/api/chat") {
        return await handleChat(request, env, origin);
      }

      // --- Auth ---
      if (method === "POST" && pathname === "/api/admin/auth") {
        return await handleAdminAuth(request, env, origin);
      }
      if (method === "POST" && pathname === "/api/guest/auth") {
        return await handleGuestAuth(request, env, origin);
      }

      return jsonResponse({ error: "Not Found" }, 404, origin);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: "Internal Server Error" }, 500, origin);
    }
  },
};
