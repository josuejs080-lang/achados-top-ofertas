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
  return m
    ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "")
    : "";
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

      const visit = value => {
        if (!value || typeof value !== "object") return;

        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }

        const types = []
          .concat(value["@type"] || [])
          .map(type => String(type).toLowerCase());

        if (types.includes("product")) {
          products.push(value);
        }

        if (value["@graph"]) visit(value["@graph"]);
        if (value.itemListElement) visit(value.itemListElement);
      };

      visit(json);
    } catch {
      // Ignora JSON-LD inválido.
    }
  }

  return products[0] || null;
}

function textFromTitle(html) {
  const match = html.match(
    /<title\b[^>]*>([\s\S]*?)<\/title>/i
  );

  return match
    ? decodeEntities(
        match[1]
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim()
      )
    : "";
}

function cleanPrice(value) {
  if (value == null) return "";

  let s = String(value)
    .replace(/[^\d.,]/g, "")
    .trim();

  if (!s) return "";

  if (s.includes(",") && s.includes(".")) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const number = Number(s);

  if (!Number.isFinite(number) || number <= 0) return "";

  return number.toFixed(2);
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).href;
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

  // 1. Dados estruturados do produto.
  let price =
    offer.price ??
    offer.lowPrice ??
    offer.priceSpecification?.price ??
    "";

  price = cleanPrice(price);
  if (price) return price;

  // 2. Metadados de preço da página.
  price = metaValue(html, [
    "product:price:amount",
    "og:price:amount",
    "product:sale_price:amount",
    "product:price",
    "price"
  ]);

  price = cleanPrice(price);
  if (price) return price;

  // 3. Campos comuns encontrados em páginas de lojas.
  const patterns = [
    /"sale_price"\s*:\s*"?([\d.,]+)"?/i,
    /"current_price"\s*:\s*"?([\d.,]+)"?/i,
    /"price"\s*:\s*\{\s*"amount"\s*:\s*"?([\d.,]+)"?/i,
    /"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i,
    /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
    /content=["']([\d.,]+)["'][^>]*itemprop=["']price["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match) {
      price = cleanPrice(match[1]);
      if (price) return price;
    }
  }

  return "";
}

function extractOldPrice(html, product) {
  const offer = getOffer(product);

  let oldPrice =
    offer.highPrice ??
    product?.priceSpecification?.price ??
    "";

  oldPrice = cleanPrice(oldPrice);
  if (oldPrice) return oldPrice;

  oldPrice = metaValue(html, [
    "product:original_price:amount",
    "product:price:original_amount",
    "product:retail_price:amount",
    "product:original_price"
  ]);

  return cleanPrice(oldPrice);
}

async function getAllowedPage(inputUrl) {
  let current;

  try {
    current = new URL(inputUrl);
  } catch {
    throw new Error("O link informado não é válido.");
  }

  if (
    current.protocol !== "https:" ||
    !allowedHost(current.hostname)
  ) {
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
        "Accept":
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7"
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");

      if (!location) {
        throw new Error(
          "A loja redirecionou sem informar o destino."
        );
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
      throw new Error(
        "A loja respondeu com status " + response.status + "."
      );
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error(
        "A página não retornou HTML legível."
      );
    }

    return {
      response,
      finalUrl: current.href
    };
  }

  throw new Error("O link teve redirecionamentos demais.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/product-meta") {
      if (request.method !== "GET") {
        return Response.json(
          { error: "Método não permitido." },
          { status: 405 }
        );
      }

      const raw = url.searchParams.get("url");

      if (!raw || raw.length > 3000) {
        return Response.json(
          { error: "Informe um link de produto válido." },
          { status: 400 }
        );
      }

      try {
        const { response, finalUrl } =
          await getAllowedPage(raw);

        const html = (await response.text()).slice(
          0,
          3_000_000
        );

        const product = parseJsonLd(html);

        let title =
          metaValue(html, [
            "og:title",
            "twitter:title",
            "product:title"
          ]) ||
          product?.name ||
          textFromTitle(html);

        let image =
          metaValue(html, [
            "og:image",
            "twitter:image"
          ]) ||
          (Array.isArray(product?.image)
            ? product.image[0]
            : product?.image) ||
          "";

        image = absoluteUrl(image, finalUrl);

        const price = extractPrice(html, product);
        const oldPrice = extractOldPrice(html, product);

        title = String(title || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240);

        return Response.json(
          {
            title,
            image,
            price,
            oldPrice,
            finalUrl,
            note:
              !price
                ? "A loja não disponibilizou um preço legível nesta página. Pode ser necessário consultar a página individual do produto."
                : "O preço foi extraído dos dados disponíveis na página. Confira se corresponde à oferta selecionada."
          },
          {
            headers: {
              "Cache-Control": "no-store"
            }
          }
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
