const ALLOWED_HOSTS = [
  "shopee.com.br", "mercadolivre.com.br", "mercadolibre.com", "meli.la",
  "tiktok.com", "tiktokshop.com"
];

function allowedHost(hostname) {
  const h = hostname.toLowerCase();
  return ALLOWED_HOSTS.some(root => h === root || h.endsWith("." + root));
}
function decodeEntities(s = "") {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
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
      const name = (attr(tag, "property") || attr(tag, "name") || attr(tag, "itemprop")).toLowerCase();
      if (name === key.toLowerCase()) {
        const value = attr(tag, "content");
        if (value) return value.trim();
      }
    }
  }
  return "";
}
function parseJsonLd(html) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const out = [];
  for (const s of scripts) {
    const body = s.replace(/^.*?>/s, "").replace(/<\/script>\s*$/i, "");
    try {
      const json = JSON.parse(body);
      const visit = x => {
        if (!x || typeof x !== "object") return;
        if (Array.isArray(x)) return x.forEach(visit);
        const types = [].concat(x["@type"] || []).map(v => String(v).toLowerCase());
        if (types.includes("product")) out.push(x);
        if (x["@graph"]) visit(x["@graph"]);
        if (x.itemListElement) visit(x.itemListElement);
      };
      visit(json);
    } catch {}
  }
  return out[0] || null;
}
function textFromTitle(html) {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()) : "";
}
function cleanPrice(value) {
  if (value == null) return "";
  const s = String(value).replace(/[^\d.,]/g, "").trim();
  if (!s) return "";
  if (s.includes(",") && s.includes(".")) {
    return s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  }
  if (s.includes(",")) return s.replace(",", ".");
  return s;
}
function absoluteUrl(value, base) {
  try { return new URL(value, base).href; } catch { return ""; }
}
async function getAllowedPage(inputUrl) {
  let current = new URL(inputUrl);
  if (current.protocol !== "https:" || !allowedHost(current.hostname)) {
    throw new Error("Use um link HTTPS da Shopee, Mercado Livre ou TikTok Shop.");
  }
  for (let i = 0; i < 6; i++) {
    const response = await fetch(current.href, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AchadosTopPreview/1.0; +https://workers.dev)",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (!location) throw new Error("A loja redirecionou sem informar o destino.");
      current = new URL(location, current);
      if (current.protocol !== "https:" || !allowedHost(current.hostname)) {
        throw new Error("O link redirecionou para um domínio que não pode ser consultado.");
      }
      continue;
    }
    if (!response.ok) throw new Error("A loja respondeu com status " + response.status + ".");
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      throw new Error("A página não retornou HTML legível.");
    }
    return { response, finalUrl: current.href };
  }
  throw new Error("O link teve redirecionamentos demais.");
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/product-meta") {
      if (request.method !== "GET") return Response.json({ error: "Método não permitido." }, { status: 405 });
      const raw = url.searchParams.get("url");
      if (!raw || raw.length > 3000) return Response.json({ error: "Informe um link de produto válido." }, { status: 400 });
      try {
        const { response, finalUrl } = await getAllowedPage(raw);
        const html = (await response.text()).slice(0, 3_000_000);
        const product = parseJsonLd(html);
        const offer = product?.offers ? (Array.isArray(product.offers) ? product.offers[0] : product.offers) : {};
        let title = metaValue(html, ["og:title", "twitter:title", "product:title"]) || product?.name || textFromTitle(html);
        let image = metaValue(html, ["og:image", "twitter:image"]) || (Array.isArray(product?.image) ? product.image[0] : product?.image) || "";
        image = absoluteUrl(image, finalUrl);
        let price = metaValue(html, [
  "product:price:amount",
  "og:price:amount",
  "product:sale_price:amount",
  "twitter:data1"
]) || offer?.price || offer?.lowPrice || "";

let oldPrice = metaValue(html, [
  "product:original_price:amount",
  "product:price:original_amount",
  "product:retail_price:amount"
]) || offer?.highPrice || "";

if (!price) {
  const patterns = [
    /"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i,
    /"sale_price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i,
    /"amount"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i,
    /itemprop=["']price["'][^>]*content=["'](\d+(?:[.,]\d{1,2})?)["']/i,
    /content=["'](\d+(?:[.,]\d{1,2})?)["'][^>]*itemprop=["']price["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      price = match[1];
      break;
    }
  }
}

price = cleanPrice(price);
oldPrice = cleanPrice(oldPrice);
        title = String(title || "").replace(/\s+/g, " ").trim().slice(0, 240);
        return Response.json({
          title, image, price, oldPrice,
          finalUrl,
          note: "O cupom normalmente não fica nos metadados do produto e precisa ser informado manualmente."
        }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({ error: error?.message || "Não foi possível consultar o produto." }, { status: 422 });
      }
    }
    return env.ASSETS.fetch(request);
  }
};
