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
  return ALLOWED_HOSTS.some(
    root => h === root || h.endsWith("." + root)
  );
}

function decodeEntities(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function attr(tag, name) {
  const re = new RegExp(
    `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
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
  const scripts =
    html.match(
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

        if (Array.isArray(obj)) {
          obj.forEach(visit);
          return;
        }

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
    ? decodeEntities(
        m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      )
    : "";
}

function cleanPrice(value) {
  if (value == null) return "";

  let s = String(value).replace(/[^\d.,]/g, "").trim();
  if (!s) return "";

  if (s.includes(",") && s.includes(".")) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
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

  price = cleanPrice(
    metaValue(html, [
      "product:price:amount",
      "og:price:amount",
      "product:sale_price:amount",
      "product:price"
    ])
  );

  if (price) return price;

  const patterns = [
    /"sale_price"\s*:\s*"?([\d.,]+)"?/i,
    /"current_price"\s*:\s*"?([\d.,]+)"?/i,
    /"price"\s*:\s*\{\s*"amount"\s*:\s*"?([\d.,]+)"?/i,
    /"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i,
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

function extractMlItemId(url, html = "") {
  // Procura o identificador na URL e no HTML da própria página.
  // Não usa IDs encontrados em links de produtos relacionados.
  const candidates = [url];

  try {
    const u = new URL(url);
    const pathMatch = u.pathname.match(/\/MLB-?(\d{6,})(?:\/|$)/i);
    if (pathMatch) return "MLB" + pathMatch[1];

    const queryId = u.searchParams.get("item_id");
    if (queryId && /^MLB-?\d{6,}$/i.test(queryId)) {
      return queryId.replace("-", "").toUpperCase();
    }
  } catch {}

  // Só aceita IDs presentes em URLs canônicas ou metadados de item.
  const canonical = html.match(
    /<link\b[^>]*rel=["']canonical["'][^>]*>/i
  );

  if (canonical) {
    const href = attr(canonical[0], "href");
    if (href) candidates.push(href);
  }

  const ogUrl = metaValue(html, ["og:url"]);
  if (ogUrl) candidates.push(ogUrl);

  for (const candidate of candidates) {
    try {
      const u = new URL(candidate);
      const match = u.pathname.match(/\/MLB-?(\d{6,})(?:\/|$)/i);
      if (match) return "MLB" + match[1];
    } catch {}
  }

  return "";
}

function redirectUri(request) {
  return new URL("/api/ml-callback", request.url).href;
}

function jsonError(message, status = 400) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

async function saveToken(env, token) {
  token.expires_at =
    Date.now() + Number(token.expires_in || 0) * 1000;

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
    // Não apaga o token antigo; a reconexão pode ser necessária.
    throw new Error(
      "A autorização do Mercado Livre expirou ou não pôde ser renovada. Acesse /api/ml-auth para reconectar."
    );
  }

  const fresh = await response.json();

  // O Mercado Livre pode fornecer um refresh token novo.
  if (!fresh.refresh_token) fresh.refresh_token = token.refresh_token;

  return saveToken(env, fresh);
}

async function fetchMlItem(itemId, env) {
  const token = await getMlToken(env);

  if (!token) {
    return {
      needsAuthorization: true
    };
  }

  const response = await fetch(
    "https://api.mercadolibre.com/items/" + encodeURIComponent(itemId),
    {
      headers: {
        Authorization: "Bearer " + token.access_token,
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      "A API do Mercado Livre não retornou o item (HTTP " +
      response.status +
      "). Verifique a autorização e o link do produto."
    );
  }

  const item = await response.json();

  return {
    title: item.title || "",
    image:
      item.thumbnail ||
      item.pictures?.[0]?.secure_url ||
      item.pictures?.[0]?.url ||
      "",
    price: cleanPrice(item.price),
    oldPrice: cleanPrice(item.original_price),
    finalUrl: item.permalink || "",
    source: "mercadolivre_api"
  };
}

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
        "User-Agent":
          "Mozilla/5.0 (compatible; AchadosTopPreview/1.0)",
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7"
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");

      if (!location) {
        throw new Error("A loja redirecionou sem informar o destino.");
      }

      current = new URL(location, current);

      if (
        current.protocol !== "https:" ||
        !allowedHost(current.hostname)
      ) {
        throw new Error(
          "O link redirecionou para um domínio não permitido."
        );
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Inicia a autorização da conta do Mercado Livre.
    if (url.pathname === "/api/ml-auth") {
      if (
        !env.ML_CLIENT_ID ||
        !env.ML_CLIENT_SECRET ||
        !env.ML_TOKENS
      ) {
        return jsonError(
          "Configure ML_CLIENT_ID, ML_CLIENT_SECRET e o KV ML_TOKENS.",
          500
        );
      }

      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);

      const state = Array.from(bytes, b =>
        b.toString(16).padStart(2, "0")
      ).join("");

      await env.ML_TOKENS.put("state:" + state, "pending", {
        expirationTtl: 600
      });

      const authUrl = new URL(
        "https://auth.mercadolivre.com.br/authorization"
      );

      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", env.ML_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", redirectUri(request));
      authUrl.searchParams.set("state", state);

      return Response.redirect(authUrl.href, 302);
    }

    // Recebe a autorização e guarda os tokens no KV.
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
          "A autorização expirou ou o estado é inválido. Abra /api/ml-auth e tente novamente.",
          400
        );
      }

      await env.ML_TOKENS.delete(stateKey);

      const form = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.ML_CLIENT_ID,
        client_secret: env.ML_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri(request)
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
        return new Response(
          "Não foi possível concluir a autorização (HTTP " +
          response.status +
          "). Confira a URI de redirecionamento cadastrada no Mercado Livre.",
          { status: 502 }
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

    // Consulta os metadados do produto.
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
        const isMercadoLivre =
          originalHost === "meli.la" ||
          originalHost.endsWith(".meli.la") ||
          originalHost === "mercadolivre.com.br" ||
          originalHost.endsWith(".mercadolivre.com.br") ||
          originalHost === "mercadolibre.com" ||
          originalHost.endsWith(".mercadolibre.com");

        // Para Mercado Livre, prioriza exclusivamente o item identificado
        // e o preço devolvido pela API autenticada.
        if (isMercadoLivre) {
          const itemId = extractMlItemId(finalUrl, html);

          if (!itemId) {
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
                  "Não foi possível identificar um item específico neste link. Abra o anúncio individual do produto e copie o link direto."
              },
              { headers: { "Cache-Control": "no-store" } }
            );
          }

          const ml = await fetchMlItem(itemId, env);

          if (ml.needsAuthorization) {
            return Response.json(
              {
                error:
                  "Conecte primeiro sua conta do Mercado Livre acessando /api/ml-auth no domínio do Achados Top."
              },
              { status: 401 }
            );
          }

          return Response.json(
            {
              title: ml.title,
              image: absoluteUrl(ml.image, ml.finalUrl || finalUrl),
              price: ml.price,
              oldPrice: ml.oldPrice,
              finalUrl: ml.finalUrl || finalUrl,
              note: ml.price
                ? "Preço obtido da API do Mercado Livre."
                : "A API não forneceu um preço para este item."
            },
            { headers: { "Cache-Control": "no-store" } }
          );
        }

        // Shopee e TikTok: tenta obter metadados publicados pela própria loja.
        let title =
          metaValue(html, ["og:title", "twitter:title", "product:title"]) ||
          product?.name ||
          textFromTitle(html);

        let image =
          metaValue(html, ["og:image", "twitter:image"]) ||
          (Array.isArray(product?.image)
            ? product.image[0]
            : product?.image) ||
          "";

        image = absoluteUrl(image, finalUrl);

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
            error:
              error?.message ||
              "Não foi possível consultar o produto."
          },
          { status: 422 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
