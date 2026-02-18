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

async function handleGetItems(env: Env, origin: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM items ORDER BY is_funded ASC, created_at ASC"
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

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO contributions (item_id, contributor_name, amount, message)
       VALUES (?, ?, ?, ?)`
    ).bind(
      itemId,
      name,
      appliedAmount,
      sanitise(body.message, MAX_MESSAGE_LENGTH)
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

async function handleChat(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  if (!isGuest(request, env) && !isAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const body = (await request.json()) as { message?: string };
  const message = sanitise(body.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    return jsonResponse({ error: "message is required" }, 400, origin);
  }

  // --- Rate limiting: 10 messages per IP per day ---
  const ip = getIP(request);
  const day = todayUTC();

  const row = await env.DB.prepare(
    "SELECT count FROM chat_rate_limit WHERE ip=? AND day=?"
  ).bind(ip, day).first<{ count: number }>();

  const currentCount = row?.count ?? 0;
  if (currentCount >= CHAT_DAILY_LIMIT) {
    return jsonResponse(
      { error: "Limite diário de mensagens atingido. Tenta novamente amanhã." },
      429,
      origin
    );
  }

  await env.DB.prepare(
    `INSERT INTO chat_rate_limit (ip, day, count) VALUES (?, ?, 1)
     ON CONFLICT(ip, day) DO UPDATE SET count = count + 1`
  ).bind(ip, day).run();

  // Fetch current gift state for AI context
  const { results: items } = await env.DB.prepare(
    `SELECT id, title, description, price_total, price_raised, is_funded, product_url
     FROM items ORDER BY is_funded ASC, created_at ASC`
  ).all<Item>();

  const giftContext =
    items.length > 0
      ? items
          .map((item) => {
            const pct =
              item.price_total > 0
                ? Math.round((item.price_raised / item.price_total) * 100)
                : 0;
            const status = item.is_funded
              ? "FULLY FUNDED"
              : `${pct}% funded (€${item.price_raised.toFixed(2)} of €${item.price_total.toFixed(2)} raised)`;
            return `- ${item.title}: ${item.description} | Price: €${item.price_total.toFixed(2)} | Status: ${status}`;
          })
          .join("\n")
      : "No gift items have been added yet.";

  const systemPrompt = `You are a warm and friendly assistant for the baby shower of Maria Luísa.
Your role is to help guests with anything related to the event: location, directions, schedule, the gift registry, and how to contribute.

EVENT DETAILS:
- Name: Baby Shower Maria Luísa
- Date: Friday, 11 April 2025
- Time: 15h00 – 19h00
- Venue: Messe de Évora, Évora, Portugal
- Google Maps: https://maps.google.com?q=Messe+de+Évora,+Évora,+Portugal
- Directions: Each guest's route will vary — suggest they use Google Maps or Waze with "Messe de Évora" as the destination.

GIFT REGISTRY:
${giftContext}

Guidelines:
- Be warm, brief, and helpful. Keep responses under 120 words.
- Answer questions about the event: date, time, location, how to get there, parking, etc.
- When asked for gift recommendations, prioritise items that are NOT yet fully funded.
- If asked how to contribute, tell guests to use the "Contribuir" button on any gift card, or scroll down to the contribution form.
- Do not discuss topics unrelated to the baby shower, the event, or the gift registry.
- If no gifts are listed yet, say the registry is being prepared and to check back soon.
- Always respond in European Portuguese.`;

  const aiResponse = await env.AI.run(
    "@cf/meta/llama-3-8b-instruct" as Parameters<typeof env.AI.run>[0],
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      max_tokens: 300,
    }
  );

  const reply =
    (aiResponse as { response?: string }).response ??
    "Estou com dificuldades em responder agora. Por favor tenta novamente!";

  return jsonResponse({ reply }, 200, origin);
}

async function handleAdminAuth(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  const body = (await request.json()) as { password?: string };
  if (body.password === env.ADMIN_PASSWORD) {
    return jsonResponse({ success: true }, 200, origin);
  }
  return jsonResponse({ error: "Incorrect password" }, 401, origin);
}

async function handleGuestAuth(
  request: Request,
  env: Env,
  origin: string
): Promise<Response> {
  const body = (await request.json()) as { password?: string };
  if (body.password === env.GUEST_PASSWORD) {
    return jsonResponse({ success: true }, 200, origin);
  }
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
