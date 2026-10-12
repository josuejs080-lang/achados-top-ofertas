
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
  retornar ALLOWED_HOSTS.some(root => h === root || h.endsWith("." + root));
}

função decodificarEntidades(s = "") {
  retornar s
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/'|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

função attr(tag, nome) {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  retornar m ? decodificarEntidades(m[1] ?? m[2] ?? m[3] ?? "") : "";
}

função metaValor(html, chaves) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  para (const key de keys) {
    para (const tag de tags) {
      const nome = (
        attr(tag, "propriedade") ||
        attr(tag, "nome") ||
        attr(tag, "itemprop")
      ).paraLowerCase();

      se (nome === chave.paraLowerCase()) {
        const value = attr(tag, "content");
        se (valor) retorne valor.trim();
      }
    }
  }
  retornar "";
}

função parseJsonLd(html) {
  const scripts = html.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  const produtos = [];

  para (const script de scripts) {
    const corpo = script
      .replace(/^.*?>/s, "")
      .replace(/<\/script>\s*$/i, "");

    tentar {
      const json = JSON.parse(body);

      função visit(obj) {
        se (!obj || typeof obj !== "object") retornar;
        if (Array.isArray(obj)) return obj.forEach(visit);

        const types = [].concat(obj["@type"] || []);
        se (types.some(t => String(t).toLowerCase() === "product")) {
          produtos.push(obj);
        }

        se (obj["@graph"]) visite(obj["@graph"]);
        se (obj.itemListElement) visite(obj.itemListElement);
      }

      visitar(json);
    } pegar {}
  }

  retornar produtos[0] || nulo;
}

função textoDoTítulo(html) {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  retornar m
    ? decodeEntities(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    : "";
}

função preçoLimpo(valor) {
  se (valor == nulo) retorne "";

  let s = String(value).replace(/[^\d.,]/g, "").trim();
  se (!s) retornar "";

  se (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Número(s);
  retorna Number.isFinite(n) && n > 0 && n < 100000000
    ? n.toFixed(2)
    : "";
}

função absoluteUrl(valor, base) {
  tentar {
    const u = new URL(valor, base);
    retornar ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } pegar {
    retornar "";
  }
}

função obterOferta(produto) {
  se (!produto?.ofertas) retorne {};
  retornar Array.isArray(produto.ofertas)
    ? produto.ofertas[0] || {}
    : ofertas de produtos;
}

função extrairPreço(html, produto) {
  const oferta = getOffer(produto);
  let price = cleanPrice(offer.price ?? offer.lowPrice ?? "");
  se (preço) retornar preço;

  preço = preçoLimpo(metaValor(html, [
    "produto:preço:quantidade",
    "og:preço:quantidade",
    "produto:preço_de_venda:quantidade",
    "produto:preço"
  ]));
  se (preço) retornar preço;

  const padrões = [
    /"preço_de_venda"\s*:\s*"?([\d.,]+)"?/i,
    /"preço_atual"\s*:\s*"?([\d.,]+)"?/i,
    /"preço"\s*:\s*\{\s*"quantidade"\s*:\s*"?([\d.,]+)"?/i,
    /"preço"\s*:\s*"?(\\d+(?:[.,]\d{1,2})?)"?/i,
    /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
    /content=["']([\d.,]+)["'][^>]*itemprop=["']price["']/i
  ];

  para (const re de padrões) {
    const m = html.match(re);
    se (m && (preço = preçoLimpo(m[1]))) retorne preço;
  }

  retornar "";
}

função extrairPreçoAntigo(html, produto) {
  const oferta = getOffer(produto);
  retornar preço limpo(
    oferta.preço alto ??
    metaValor(html, [
      "produto:preço_original:quantidade",
      "produto:preço:valor_original",
      "produto:preço_de_varejo:quantidade"
    ])
  );
}

/* ===== SHOPEE ===== */

função obterIdsShopee(valor) {
  tentar {
    const u = new URL(valor);
    let shopid = u.searchParams.get("shopid") || "";
    let itemid = u.searchParams.get("itemid") || "";

    const m =
      u.pathname.match(/\/product\/(\d{5,})\/(\d{5,})/i) ||
      u.pathname.match(/-i\.(\d{5,})\.(\d{5,})(?:\/|$)/i);

    se (m) {
      shopid = shopid || m[1];
      itemid = itemid || m[2];
    }

    retornar /^\d+$/.test(shopid) && /^\d+$/.test(itemid)
      ? { shopid, itemid }
      : nulo;
  } pegar {
    retornar nulo;
  }
}

função shopeePrice(valor) {
  se (valor == nulo || valor === "") retorne "";

  const n = Número(valor);
  se (!Number.isFinite(n) || n <= 0) retorne "";

  retornar preçoLimpo(n >= 100000 ? n / 100000 : n);
}

função assíncrona buscarItemShopee(URLfinal) {
  constids = getShopeeIds(finalUrl);
  se (!ids) retornar nulo;

  tentar {
    const apiUrl = new URL("https://shopee.com.br/api/v4/item/get");
    apiUrl.searchParams.set("itemid", ids.itemid);
    apiUrl.searchParams.set("shopid", ids.shopid);

    const response = await fetch(apiUrl.href, {
      cabeçalhos: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
        "Aceitar": "application/json",
        "Referenciador": "https://shopee.com.br/"
      }
    });

    se (!response.ok) retorne nulo;

    const json = await response.json();
    const item = json?.data?.item || json?.data;
    Se (!item || typeof item !== "objeto") retornar nulo;

    const rawImage = item.image || item.images?.[0] || "";
    const image = rawImage
      ? (/^https?:\/\//i.test(rawImage)
          ? imagem bruta
          : "https://down-br.img.susercontent.com/file/" + rawImage)
      : "";

    const preço = preçoShopee(
      item.price_min ?? item.price ?? item.price_max ?? ""
    );

    const preçoAntigo = preçoShopee(
      item.price_before_discount ??
      item.price_min_before_discount ??
      ""
    );

    Se (!item.name && !price && !image) retornar nulo;

    retornar {
      título: String(item.name || "").trim(),
      imagem,
      preço,
      preço antigo,
      URL final
    };
  } pegar {
    retornar nulo;
  }
}

/* ===== OAUTH MERCADO LIVRE ===== */

função redirectUri(request) {
  retornar novo URL("/api/ml-callback", request.url).href;
}

função jsonError(mensagem, status = 400) {
  retornar Response.json(
    { erro: mensagem },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

função base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  retornar btoa(binário)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

função assíncrona criarPkce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    novo TextEncoder().encode(verificador)
  );

  retornar {
    verificador,
    desafio: base64url(novo Uint8Array(digest))
  };
}

função assíncrona salvarToken(env, token) {
  token.expires_at = Date.now() + Number(token.expires_in || 0) * 1000;
  await env.ML_TOKENS.put("oauth", JSON.stringify(token));
  token de retorno;
}

função assíncrona getMlToken(env) {
  if (!env.ML_TOKENS || !env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    throw new Error("Faltam as configurações da API do Mercado Livre.");
  }

  const raw = await env.ML_TOKENS.get("oauth");
  se (!raw) retornar nulo;

  deixe o token;
  tentar {
    token = JSON.parse(raw);
  } pegar {
    retornar nulo;
  }

  se (
    token.access_token &&
    token.expires_at &&
    Date.now() < token.expires_at - 60000
  ) {
    token de retorno;
  }

  Se (!token.refresh_token) retornar nulo;

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
    token_de_atualização: token.token_de_atualização
  });

  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    método: "POST",
    cabeçalhos: { "Content-Type": "application/x-www-form-urlencoded" },
    corpo: forma
  });

  se (!response.ok) {
    lançar novo Erro(
      "A autorização expirou ou não pôde ser renovada. Acesse /api/ml-auth para reconectar."
    );
  }

  const fresh = await response.json();
  if (!fresh.refresh_token) fresh.refresh_token = token.refresh_token;

  retornar saveToken(env, fresh);
}

/* ===== BUSCA DE CÓDIGOS DE ANÚNCIO MLB ===== */

função extractMlItemIds(finalUrl, html = "") {
  const ids = novo Set();

  função adicionarId(valor) {
    se (!valor) retornar;
    const matches = String(value).match(/\bMLB-?\d{6,}\b/gi) || [];

    para (constante correspondência de correspondências) {
      ids.add(match.replace("-", "").toUpperCase());
      se (ids.size >= 30) retorne;
    }
  }

  função adicionarDaUrl(valor) {
    se (!valor) retornar;

    tentar {
      const u = new URL(valor, URLfinal);
      se (!allowedHost(u.hostname)) retorne;

      const pathMatch = u.pathname.match(/\/MLB-?(\d{6,})(?:\/|$)/i);
      if (pathMatch) addId("MLB" + pathMatch[1]);

      addId(u.searchParams.get("item_id"));
      addId(u.searchParams.get("itemId"));
      addId(u.searchParams.get("wid"));
      adicionarId(u.href);
    } pegar {}
  }

  adicionarDeUrl(UrlFinal);

  const tags = html.match(/<(?:link|meta|a)\b[^>]*>/gi) || [];
  para (const tag de tags) {
    addFromUrl(attr(tag, "href"));
    addFromUrl(attr(tag, "content"));
    adicionarId(attr(tag, "href"));
    adicionarId(attr(tag, "content"));
    se (ids.size >= 30) interrompa;
  }

  const canonical = html.match(
    /<link\b[^>]*rel=["']canonical["'][^>]*>/i
  );
  se (canônico) adicionarDeUrl(attr(canônico[0], "href"));

  addFromUrl(metaValue(html, ["og:url", "twitter:url"]));

  const decodedHtml = html
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&/g, "&");

  adicionarId(Html decodificado);

  const foundUrls =
    decodedHtml.match(/https?:\/\/[^"'<>\\\s]+/gi) || [];

  para (valor constante de foundUrls) {
    adicionarDeUrl(valor);
    se (ids.size >= 30) interrompa;
  }

  retornar [...ids].slice(0, 30);
}

função assíncrona buscarMlItem(itemId, env) {
  const token = await getMlToken(env);
  se (!token) retornar { precisa de autorização: verdadeiro };

  const resposta = aguardar busca(
    "https://api.mercadolibre.com/items/" + encodeURIComponent(itemId),
    {
      cabeçalhos: {
        Autorização: "Portador " + token.access_token,
        Aceitar: "application/json"
      }
    }
  );

  se (!response.ok) {
    const detail = await response.text();
    lançar novo Erro(
      "A API do Mercado Livre não devolveu o item (HTTP " +
      response.status + "): " + detail.slice(0, 300)
    );
  }

  const item = await response.json();

  retornar {
    título: item.title || "",
    imagem:
      item.miniatura ||
      item.pictures?.[0]?.secure_url ||
      item.pictures?.[0]?.url ||
      ","
    preço: preçoLimpo(item.preço),
    preço_antigo: preço_limpo(item.preço_original),
    URL final: item.permalink || ""
  };
}

/* ===== RESOLUÇÃO DE LINKS ===== */

função assíncrona getAllowedPage(inputUrl) {
  deixe a corrente;

  tentar {
    atual = novo URL(inputUrl);
  } pegar {
    throw new Error("O link informado não é válido.");
  }

  se (current.protocol !== "https:" || !allowedHost(current.hostname)) {
    lançar novo Erro(
      "Use um link HTTPS da Shopee, Mercado Livre ou TikTok Shop."
    );
  }

  para (seja i = 0; i < 6; i++) {
    const response = await fetch(current.href, {
      redirecionar: "manual",
      cabeçalhos: {
        "User-Agent": "Mozilla/5.0 (compatível; AcadosTopPreview/1.0)",
        "Aceitar": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7"
      }
    });

    se ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      se (!localização) {
        throw new Error("A loja redirecionou sem informar o destino.");
      }

      atual = nova URL(localização, atual);

      se (current.protocol !== "https:" || !allowedHost(current.hostname)) {
        throw new Error("O link redirecionado para um domínio não permitido.");
      }

      continuar;
    }

    se (!response.ok) {
      throw new Error("A loja respondeu com status " + response.status + ".");
    }

    const type = response.headers.get("content-type") || "";
    se (
      !type.includes("text/html") &&
      !type.includes("application/xhtml+xml")
    ) {
      throw new Error("A página não retornou HTML legível.");
    }

    retornar { resposta, URL final: current.href };
  }

  throw new Error("O link teve redirecionamentos demais.");
}

/* ===== PONTOS FINAIS ===== */

exportar padrão {
  async fetch(request, env) {
    const url = new URL(request.url);

    se (url.pathname === "/api/ml-auth") {
      se (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET || !env.ML_TOKENS) {
        retornar jsonError(
          "Configurar ML_CLIENT_ID, ML_CLIENT_SECRET eo KV ML_TOKENS."
          500
        );
      }

      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);

      const state = Array.from(
        bytes,
        b => b.toString(16).padStart(2, "0")
      ).juntar("");

      const pkce = await createPkce();

      aguarde env.ML_TOKENS.put(
        "estado:" + estado,
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

      retornar Response.redirect(authUrl.href, 302);
    }

    se (url.pathname === "/api/ml-callback") {
      se (url.searchParams.get("error")) {
        retornar nova resposta(
          "A autorização foi recusada. Volte ao Achados Top e tente novamente.",
          { status: 400 }
        );
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      se (!código || !estado || !env.ML_TOKENS) {
        return jsonError("Retorno OAuth incompleto.", 400);
      }

      const stateKey = "estado:" + estado;
      const savedState = await env.ML_TOKENS.get(stateKey);

      se (!savedState) {
        retornar jsonError(
          "Estado OAuth inválido ou expirado. Inicie uma nova autorização.",
          400
        );
      }

      deixe pkceData;
      tentar {
        pkceData = JSON.parse(savedState);
      } pegar {
        return jsonError("Dados PKCE inválidos. Tente novamente.", 400);
      }

      se (!pkceData.verifier) {
        retornar jsonError(
          "Code verifier ausente. Inicie uma nova autorização.",
          400
        );
      }

      aguarde env.ML_TOKENS.delete(stateKey);

      const form = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.ML_CLIENT_ID,
        client_secret: env.ML_CLIENT_SECRET,
        código,
        redirect_uri: redirectUri(request),
        verificador_de_código: pkceData.verificador
      });

      const resposta = aguardar busca(
        "https://api.mercadolibre.com/oauth/token",
        {
          método: "POST",
          cabeçalhos: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          corpo: forma
        }
      );

      se (!response.ok) {
        const detail = await response.text();
        retornar nova resposta(
          "Erro OAuth HTTP " + response.status + ": " + detalhe,
          {
            status: 502,
            cabeçalhos: {
              "Content-Type": "text/plain; charset=utf-8",
              "Controle de cache": "não armazenar"
            }
          }
        );
      }

      const token = await response.json();
      aguardar salvarToken(env, token);

      retornar nova resposta(
        "Conta do Mercado Livre conectada ao Achados Top. Você já pode voltar ao site.",
        {
          cabeçalhos: {
            "Content-Type": "text/plain; charset=utf-8",
            "Controle de cache": "não armazenar"
          }
        }
      );
    }

    se (url.pathname === "/api/product-meta") {
      se (request.method !== "GET") {
        return jsonError("Método não permitido.", 405);
      }

      const raw = url.searchParams.get("url");
      se (!raw || raw.length > 3000) {
        return jsonError("Informe um link de produto válido.", 400);
      }

      tentar {
        const { response, finalUrl } = await getAllowedPage(raw);
        const html = (await response.text()).slice(0, 3000000);
        const produto = parseJsonLd(html);
        const originalHost = new URL(raw).hostname.toLowerCase();

        const éShopee =
          host original === "shopee.com.br" ||
          originalHost.endsWith(".shopee.com.br");

        se (éShopee) {
          const shopee = await fetchShopeeItem(finalUrl);

          se (shopee && shopee.title) {
            retornar Response.json(
              {
                título: shopee.title.slice(0, 240),
                imagem: absoluteUrl(shopee.image, finalUrl),
                Preço: shopee.price,
                preço antigo: shopee.preço antigo,
                URL final,
                Observação: shopee.price
                  ? "Dados consultados na Shopee; confira o preço antes de divulgar."
                  : "Nome encontrado, mas o Shopee não retornau preço legível."
              },
              { headers: { "Cache-Control": "no-store" } }
            );
          }
        }

        const isMercadoLivre =
          host original === "meli.la" ||
          originalHost.endsWith(".meli.la") ||
          originalHost === "mercadolivre.com.br" ||
          originalHost.endsWith(".mercadolivre.com.br") ||
          originalHost === "mercadolibre.com" ||
          originalHost.endsWith(".mercadolibre.com");

        se (éMercadoLivre) {
          const itemIds = extractMlItemIds(finalUrl, html);

          se (!itemIds.length) {
            retornar Response.json(
              {
                título:
                  metaValue(html, ["og:título", "twitter:título"]) ||
                  textoDoTítulo(html),
                imagem: URLabsoluta(
                  metaValue(html, ["og:imagem", "twitter:imagem"]),
                  URL final
                ),
                preço: "",
                preço antigo: "",
                URL final,
                observação:
                  "O link social não expôs um código MLB identificável. A busca ampliada não encontrou um anúncio individual para consultar."
              },
              { headers: { "Cache-Control": "no-store" } }
            );
          }

          seja ml = nulo;
          let needsAuthorization = false;

          para (const itemId de itemIds) {
            tentar {
              const candidate = await fetchMlItem(itemId, env);

              se (candidato.precisaDeAutorização) {
                precisa de autorização = verdadeiro;
                quebrar;
              }

              se (candidato.título && candidato.preço) {
                ml = candidato;
                quebrar;
              }
            } pegar {
              // Tenta o próximo código encontrado
