
const ALLOWED_HOSTS = [
  "shopee.com.br",
  "mercadolivre.com.br",
  "mercadolibre.com",
  "meli.la",
  "tiktok.com",
  "tiktokshop.com"
];

function allowedHost(hostname) {
  const h = hostname.toLowerCase();
  return ALLOWED_HOSTS.some(root => h === root || h.endsWith("." + root));
}

function decodeEntities(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function attr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : "";
}

function metaValue(html, keys) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const key of keys) {
    for (const tag of tags) {
      const name = (
        attr(tag, "property") ||
        attr(tag, "name") ||
        attr(tag, "itemprop")
      ).toLowerCase();

      if (name === key.toLowerCase()) {
        const value = attr(tag, "content");
        if (value) return value.trim();
      }
    }
  }
  return "";
}

function parseJsonLd(html) {
  const scripts = html.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  const products = [];

  for (const script of scripts) {
    const body = script
      .replace(/^.*?>/s, "")
      .replace(/<\/script>\s*$/i, "");

    try {
      const json = JSON.parse(body);

      function visit(obj) {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) return obj.forEach(visit);

        const types = [].concat(obj["@type"] || []);
        if (types.some(t => String(t).toLowerCase() === "product")) {
          products.push(obj);
        }

        if (obj["@graph"]) visit(obj["@graph"]);
        if (obj.itemListElement) visit(obj.itemListElement);
      }

      visit(json);
    } catch {}
  }

  return products[0] || null;
}

function textFromTitle(html) {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m
    ? decodeEntities(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    : "";
}

function cleanPrice(value) {
  if (value == null) return "";

  let s = String(value).replace(/[^\d.,]/g, "").trim();
  if (!s) return "";

  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 100000000
    ? n.toFixed(2)
    : "";
}

function absoluteUrl(value, base) {
  try {
    const u = new URL(value, base);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

function getOffer(product) {
  if (!product?.offers) return {};
  return Array.isArray(product.offers)
    ? product.offers[0] || {}
    : product.offers;
}

function extractPrice(html, product) {
  const offer = getOffer(product);
  let price = cleanPrice(offer.price ?? offer.lowPrice ?? "");
  if (price) return price;

  price = cleanPrice(metaValue(html, [
    "product:price:amount",
    "og:price:amount",
    "product:sale_price:amount",
    "product:price"
  ]));
  if (price) return price;

  const patterns = [
    /"sale_price"\s*:\s*"?([\d.,]+)"?/i,
    /"current_price"\s*:\s*"?([\d.,]+)"?/i,
    /"price"\s*:\s*\{\s*"amount"\s*:\s*"?([\d.,]+)"?/i,
    /"price"\s*:\s*"?(\\d+(?:[.,]\d{1,2})?)"?/i,
    /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
    /content=["']([\d.,]+)["'][^>]*itemprop=["']price["']/i
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && (price = cleanPrice(m[1]))) return price;
  }

  return "";
}

function extractOldPrice(html, product) {
  const offer = getOffer(product);
  return cleanPrice(
    offer.highPrice ??
    metaValue(html, [
      "product:original_price:amount",
      "product:price:original_amount",
      "product:retail_price:amount"
    ])
  );
}

/* ===== CONSULTA DE PRODUTOS DA SHOPEE ===== */

function getShopeeIds(value) {
  try {
    const u = new URL(value);
    let shopid = u.searchParams.get("shopid") || "";
    let itemid = u.searchParams.get("itemid") || "";

    const m =
      u.pathname.match(/\/product\/(\d{5,})\/(\d{5,})/i) ||
      u.pathname.match(/-i\.(\d{5,})\.(\d{5,})(?:\/|$)/i);

    if (m) {
      shopid = shopid || m[1];
      itemid = itemid || m[2];
    }

    return /^\d+$/.test(shopid) && /^\d+$/.test(itemid)
      ? { shopid, itemid }
      : null;
  } catch {
    return null;
  }
}

function shopeePrice(value) {
  if (value == null || value === "") return "";

  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";

  // A Shopee pode representar o preço em unidades de 1/100000.
  return cleanPrice(n >= 100000 ? n / 100000 : n);
}

async function fetchShopeeItem(finalUrl) {
  const ids = getShopeeIds(finalUrl);
  if (!ids) return null;

  try {
    const apiUrl = new URL("https://shopee.com.br/api/v4/item/get");
    apiUrl.searchParams.set("itemid", ids.itemid);
    apiUrl.searchParams.set("shopid", ids.shopid);

    const response = await fetch(apiUrl.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://shopee.com.br/"
      }
    });

    if (!response.ok) return null;

    const json = await response.json();
    const item = json?.data?.item || json?.data;

    if (!item || typeof item !== "object") return null;

    const rawImage = item.image || item.images?.[0] || "";

    const image = rawImage
      ? (/^https?:\/\//i.test(rawImage)
          ? rawImage
          : "https://down-br.img.susercontent.com/file/" + rawImage)
      : "";

    const price = shopeePrice(
      item.price_min ?? item.price ?? item.price_max ?? ""
    );

    const oldPrice = shopeePrice(
      item.price_before_discount ??
      item.price_min_before_discount ??
      ""
    );

    if (!item.name && !price && !image) return null;

    return {
      title: String(item.name || "").trim(),
      image,
      price,
      oldPrice,
      finalUrl
    };
  } catch {
    return null;
  }
}

/* ===== AUTORIZAÇÃO DO MERCADO LIVRE ===== */

function redirectUri(request) {
  return new URL("/api/ml-callback", request.url).href;
}

function jsonError(message, status = 400) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function createPkce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  return {
    verifier,
    challenge: base64url(new Uint8Array(digest))
  };
}

async function saveToken(env, token) {
  token.expires_at = Date.now() + Number(token.expires_in || 0) * 1000;
  await env.ML_TOKENS.put("oauth", JSON.stringify(token));
  return token;
}

async function getMlToken(env) {
  if (!env.ML_TOKENS || !env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    throw new Error("Faltam as configurações da API do Mercado Livre.");
  }

  const raw = await env.ML_TOKENS.get("oauth");
  if (!raw) return null;

  let token;
  try {
    token = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    token.access_token &&
    token.expires_at &&
    Date.now() < token.expires_at - 60000
  ) {
    return token;
  }

  if (!token.refresh_token) return null;

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
    refresh_token: token.refresh_token
  });

  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });

  if (!response.ok) {
    throw new Error(
      "A autorização expirou ou não pôde ser renovada. Acesse /api/ml-auth para reconectar."
    );
  }

  const fresh = await response.json();
  if (!fresh.refresh_token) fresh.refresh_token = token.refresh_token;

  return saveToken(env, fresh);
}

function extractMlItemIds(finalUrl, html = "") {
  const ids = new Set();

  function addFromUrl(value) {
    if (!value) return;

    try {
      const u = new URL(value, finalUrl);
      const pathMatch = u.pathname.match(/\/MLB-?(\d{6,})(?:\/|$)/i);

      if (pathMatch) ids.add("MLB" + pathMatch[1]);

      const queryId =
        u.searchParams.get("item_id") ||
        u.searchParams.get("itemId");

      if (queryId && /^MLB-?\d{6,}$/i.test(queryId)) {
        ids.add(queryId.replace("-", "").toUpperCase());
      }
    } catch {}
  }

  addFromUrl(finalUrl);

  const canonical = html.match(
    /<link\b[^>]*rel=["']canonical["'][^>]*>/i
  );

  addFromUrl(canonical ? attr(canonical[0], "href") : "");
  addFromUrl(metaValue(html, ["og:url", "twitter:url"]));

  const embedded = html.match(/\bMLB-?\d{6,}\b/gi) || [];

  for (const value of embedded) {
    ids.add(value.replace("-", "").toUpperCase());
    if (ids.size >= 12) break;
  }

  return [...ids].slice(0, 12);
}


function normalizeMlTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bmercado livre\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function mlTitleSimilarity(a, b) {
  const first = normalizeMlTitle(a);
  const second = normalizeMlTitle(b);

  if (!first || !second) return 0;
  if (first === second) return 1;

  const wordsA = new Set(first.split(/\s+/).filter(w => w.length > 1));
  const wordsB = new Set(second.split(/\s+/).filter(w => w.length > 1));

  if (!wordsA.size || !wordsB.size) return 0;

  let common = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) common++;
  }

  return common / Math.max(wordsA.size, wordsB.size);
}

async function searchMlItemIdsByTitle(title, env) {
  const normalized = normalizeMlTitle(title);
  if (!normalized || normalized.length < 8) return [];

  const token = await getMlToken(env);
  if (!token) return [];

  const searchUrl = new URL(
    "https://api.mercadolibre.com/sites/MLB/search"
  );

  searchUrl.searchParams.set("q", title.slice(0, 180));
  searchUrl.searchParams.set("limit", "10");

  const response = await fetch(searchUrl.href, {
    headers: {
      Authorization: "Bearer " + token.access_token,
      Accept: "application/json"
    }
  });

  if (!response.ok) return [];

  const data = await response.json();

  const candidates = (data.results || [])
    .map(item => ({
      id: String(item.id || "").toUpperCase(),
      title: item.title || "",
      score: mlTitleSimilarity(title, item.title || "")
    }))
    .filter(item => /^MLB\d+$/.test(item.id))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length || candidates[0].score < 0.80) {
    return [];
  }

  // Evita escolher entre resultados praticamente empatados.
  if (
    candidates.length > 1 &&
    candidates[0].score - candidates[1].score < 0.08
  ) {
    return [];
  }

  return [candidates[0].id];
}


  const itemResponse = await fetch(
    "https://api.mercadolibre.com/items/" +
      encodeURIComponent(itemId),
    { headers }
  );

  if (!itemResponse.ok) return null;

  const item = await itemResponse.json();

  let price = "";
  let oldPrice = "";

  // Consulta oficial do preço de venda e do preço original.
  try {
    const saleUrl = new URL(
      "https://api.mercadolibre.com/items/" +
      encodeURIComponent(itemId) +
      "/sale_price"
    );

    saleUrl.searchParams.set("context", "channel_marketplace");

    const saleResponse = await fetch(saleUrl.href, { headers });

    if (saleResponse.ok) {
      const sale = await saleResponse.json();
      price = cleanPrice(sale.amount);
      oldPrice = cleanPrice(sale.regular_amount);
    }
  } catch {
    // Continua para os campos alternativos do anúncio.
  }

  // Fallback: usa os dados do item se o endpoint de preços falhar.
  if (!price) {
    price = cleanPrice(item.price);
  }

  if (!oldPrice) {
    oldPrice = cleanPrice(item.original_price);
  }

  return {
    id: item.id || itemId,
    title: item.title || "",
    image:
      item.thumbnail ||
      item.pictures?.[0]?.secure_url ||
      item.pictures?.[0]?.url ||
      "",
    price,
    oldPrice,
    finalUrl: item.permalink || ""
  };
}


/* ===== RESOLUÇÃO DOS LINKS ===== */

async function getAllowedPage(inputUrl) {
  let current;

  try {
    current = new URL(inputUrl);
  } catch {
    throw new Error("O link informado não é válido.");
  }

  if (current.protocol !== "https:" || !allowedHost(current.hostname)) {
    throw new Error(
      "Use um link HTTPS da Shopee, Mercado Livre ou TikTok Shop."
    );
  }

  for (let i = 0; i < 6; i++) {
    const response = await fetch(current.href, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AchadosTopPreview/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7"
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");

      if (!location) {
        throw new Error("A loja redirecionou sem informar o destino.");
      }

      current = new URL(location, current);

      if (current.protocol !== "https:" || !allowedHost(current.hostname)) {
        throw new Error("O link redirecionou para um domínio não permitido.");
      }

      continue;
    }

    if (!response.ok) {
      throw new Error("A loja respondeu com status " + response.status + ".");
    }

    const type = response.headers.get("content-type") || "";

    if (
      !type.includes("text/html") &&
      !type.includes("application/xhtml+xml")
    ) {
      throw new Error("A página não retornou HTML legível.");
    }

    return { response, finalUrl: current.href };
  }

  throw new Error("O link teve redirecionamentos demais.");
}

/* ===== ENDPOINTS DA API ===== */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ml-auth") {
      if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET || !env.ML_TOKENS) {
        return jsonError(
          "Configure ML_CLIENT_ID, ML_CLIENT_SECRET e o KV ML_TOKENS.",
          500
        );
      }

      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);

      const state = Array.from(
        bytes,
        b => b.toString(16).padStart(2, "0")
      ).join("");

      const pkce = await createPkce();

      await env.ML_TOKENS.put(
        "state:" + state,
        JSON.stringify({ verifier: pkce.verifier }),
        { expirationTtl: 600 }
      );

      const authUrl = new URL(
        "https://auth.mercadolivre.com.br/authorization"
      );

      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", env.ML_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", redirectUri(request));
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", pkce.challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      return Response.redirect(authUrl.href, 302);
    }

    if (url.pathname === "/api/ml-callback") {
      if (url.searchParams.get("error")) {
        return new Response(
          "A autorização foi recusada. Volte ao Achados Top e tente novamente.",
          { status: 400 }
        );
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state || !env.ML_TOKENS) {
        return jsonError("Retorno OAuth incompleto.", 400);
      }

      const stateKey = "state:" + state;
      const savedState = await env.ML_TOKENS.get(stateKey);

      if (!savedState) {
        return jsonError(
          "Estado OAuth inválido ou expirado. Inicie uma nova autorização.",
          400
        );
      }

      let pkceData;

      try {
        pkceData = JSON.parse(savedState);
      } catch {
        return jsonError("Dados PKCE inválidos. Tente novamente.", 400);
      }

      if (!pkceData.verifier) {
        return jsonError(
          "Code verifier ausente. Inicie uma nova autorização.",
          400
        );
      }

      await env.ML_TOKENS.delete(stateKey);

      const form = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.ML_CLIENT_ID,
        client_secret: env.ML_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri(request),
        code_verifier: pkceData.verifier
      });

      const response = await fetch(
        "https://api.mercadolibre.com/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: form
        }
      );

      if (!response.ok) {
        const detail = await response.text();

        return new Response(
          "Erro OAuth HTTP " + response.status + ": " + detail,
          {
            status: 502,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store"
            }
          }
        );
      }

      const token = await response.json();
      await saveToken(env, token);

      return new Response(
        "Conta do Mercado Livre conectada ao Achados Top. Você já pode voltar ao site.",
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    if (url.pathname === "/api/product-meta") {
      if (request.method !== "GET") {
        return jsonError("Método não permitido.", 405);
      }

      const raw = url.searchParams.get("url");

      if (!raw || raw.length > 3000) {
        return jsonError("Informe um link de produto válido.", 400);
      }

      try {
        const { response, finalUrl } = await getAllowedPage(raw);
        const html = (await response.text()).slice(0, 3000000);
        const product = parseJsonLd(html);
        const originalHost = new URL(raw).hostname.toLowerCase();
const finalHost = new URL(finalUrl).hostname.toLowerCase();

const isShopee =
  originalHost === "shopee.com.br" ||
  originalHost.endsWith(".shopee.com.br") ||
  finalHost === "shopee.com.br" ||
  finalHost.endsWith(".shopee.com.br");

const isTikTokShop =
  originalHost === "tiktok.com" ||
  originalHost.endsWith(".tiktok.com") ||
  originalHost === "tiktokshop.com" ||
  originalHost.endsWith(".tiktokshop.com") ||
  finalHost === "tiktok.com" ||
  finalHost.endsWith(".tiktok.com") ||
  finalHost === "tiktokshop.com" ||
  finalHost.endsWith(".tiktokshop.com");

        if (isShopee) {
          const shopee = await fetchShopeeItem(finalUrl);

          if (shopee && shopee.title) {
            return Response.json(
              {
                title: shopee.title.slice(0, 240),
                image: absoluteUrl(shopee.image, finalUrl),
                price: shopee.price,
                oldPrice: shopee.oldPrice,
                finalUrl,
                note: shopee.price
                  ? "Dados consultados na Shopee; confira o preço antes de divulgar."
                  : "Nome encontrado, mas a Shopee não retornou preço legível."
              },
              { headers: { "Cache-Control": "no-store" } }
            );
          }
        }

        const isMercadoLivre =
          originalHost === "meli.la" ||
          originalHost.endsWith(".meli.la") ||
          originalHost === "mercadolivre.com.br" ||
          originalHost.endsWith(".mercadolivre.com.br") ||
          originalHost === "mercadolibre.com" ||
          originalHost.endsWith(".mercadolibre.com");

        if (isMercadoLivre) {
          const itemIds = extractMlItemIds(finalUrl, html);

          if (!itemIds.length) {
            return Response.json(
              {
                title:
                  metaValue(html, ["og:title", "twitter:title"]) ||
                  textFromTitle(html),
                image: absoluteUrl(
                  metaValue(html, ["og:image", "twitter:image"]),
                  finalUrl
                ),
                price: "",
                oldPrice: "",
                finalUrl,
                note:
                  "O link não expôs o código do anúncio. Use o link individual do produto, não o link do perfil ou uma página de recomendações."
              },
              { headers: { "Cache-Control": "no-store" } }
            );
          }

          let ml = null;
          let needsAuthorization = false;

          for (const itemId of itemIds) {
            try {
              const candidate = await fetchMlItem(itemId, env);

              if (candidate.needsAuthorization) {
                needsAuthorization = true;
                break;
              }

              if (candidate.title && candidate.price) {
                ml = candidate;
                break;
              }
            } catch {
              // Tenta o próximo ID encontrado.
            }
          }

          if (needsAuthorization) {
            return jsonError(
              "Conecte sua conta do Mercado Livre em /api/ml-auth.",
              401
            );
          }

          if (!ml) {
            return Response.json(
              {
                title:
                  metaValue(html, ["og:title", "twitter:title"]) ||
                  textFromTitle(html),
                image: absoluteUrl(
                  metaValue(html, ["og:image", "twitter:image"]),
                  finalUrl
                ),
                price: "",
                oldPrice: "",
                finalUrl,
                note:
                  "A página não forneceu um anúncio com preço confirmado pela API. Use o link individual do produto."
              },
              { headers: { "Cache-Control": "no-store" } }
            );
          }

          return Response.json(
            {
              title: ml.title,
              
              image: absoluteUrl(ml.image, ml.finalUrl || finalUrl),
              price: ml.price,
              oldPrice: ml.oldPrice,
              finalUrl: ml.finalUrl || finalUrl,
              note: "Preço obtido da API do Mercado Livre."
            },
            { headers: { "Cache-Control": "no-store" } }
          );
        }

        const title =
          metaValue(html, ["og:title", "twitter:title", "product:title"]) ||
          product?.name ||
          textFromTitle(html);

        const image = absoluteUrl(
          metaValue(html, ["og:image", "twitter:image"]) ||
          (Array.isArray(product?.image)
            ? product.image[0]
            : product?.image) ||
          "",
          finalUrl
        );

        const price = extractPrice(html, product);
        const oldPrice = extractOldPrice(html, product);

        return Response.json(
          {
            title: String(title || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 240),
            image,
            price,
            oldPrice,
            finalUrl,
            note: price
              ? "Preço encontrado nos metadados da página; confira se corresponde à oferta."
              : "A loja não disponibilizou um preço legível nesta página."
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (error) {
        return Response.json(
          {
            error: error?.message ||
              "Não foi possível consultar o produto."
          },
          { status: 422 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
         
