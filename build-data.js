/**
 * ============================================================================
 * SCRIPT DE BUILD PARA VERCEL / AMBIENTE LOCAL (ZERO DEPENDÊNCIAS NPM)
 *
 * Lê automaticamente todos os arquivos .csv presentes na pasta do projeto,
 * unifica e mescla os registros por SKU (cruzando NOME DO PRODUTO + MODELO +
 * MARCA + COR + TAMANHO + NÍVEL 1), classifica as categorias e gera o arquivo
 * compacto "catalogo.js" para carregamento instantâneo na Vercel (CDN/Brotli)
 * e também offline via file://.
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;

function normalizeText(value) {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\/\\|,;_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCSVLine(line, delimiter) {
  if (line.indexOf('"') === -1) return line.split(delimiter);
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

const KNOWN_BRANDS = [
  "NEW BALANCE", "UNDER ARMOUR", "NORD OUTDOOR", "SPIN ROLLER", "ASICS",
  "NIKE", "ADIDAS", "OXER", "PUMA", "OLYMPIKUS", "MIZUNO", "UMBRO",
  "FILA", "ADAMS", "NBA", "BRAZILINE", "BROOKS", "CONVERSE", "SPEEDO",
  "PENALTY", "TOPPER", "REEBOK", "VANS", "CROCS", "HAVAIANAS", "OAKLEY",
  "JORDAN", "COIMBRA", "BEL FIX", "KIKOS", "WILSON", "POKER"
];

const BRAND_ALIASES = { UA: "UNDER ARMOUR", NB: "NEW BALANCE" };

function inferBrandFromName(nomeUpper) {
  if (!nomeUpper) return "";
  for (const b of KNOWN_BRANDS) {
    if (nomeUpper.includes(" " + b + " ") || nomeUpper.endsWith(" " + b) || nomeUpper.startsWith(b + " ")) {
      return b;
    }
  }
  for (const part of nomeUpper.split(/\s+/)) {
    if (BRAND_ALIASES[part]) return BRAND_ALIASES[part];
  }
  return "";
}

function deriveModelFromProductName(nomeProduto, marca) {
  if (!nomeProduto) return "-";
  let cleaned = nomeProduto.trim().replace(
    /^(TENIS|CAMISETA\s+LS|CAMISETA|CAMISA|CHUTEIRA\s+FUTSAL|CHUTEIRA\s+SOCIETY|CHUTEIRA\s+CAMPO|CHUTEIRA|BERMUDA|SHORTS|SHORT|CALCA\s+LEGGING|CALCA\s+LS|CALCA|REGATA|TOP|JAQUETA|BLUSAO|CHINELO|SANDALIA|BOTA|KIT\s+MEIA|MEIA|MEIAO|SUNGA|MAIO|BONE|MOCHILA|CONJUNTO|CALCAO|LEGGING|POLO|OCULOS|LUVA|RAQUETE|MALA|BOLSA|PATINS)\s+/i,
    ""
  );
  if (marca) {
    const esc = marca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp("^" + esc + "\\s+", "i"), "");
  }
  cleaned = cleaned.replace(/^(UA|NB)\s+/i, "").trim();
  return cleaned || nomeProduto;
}

function classifyProductCategory(setorNorm, nomeNorm, modeloNorm, explicitCat) {
  if (explicitCat) return explicitCat;
  const text = (nomeNorm + " " + modeloNorm).trim();
  const firstWord = text.split(" ")[0] || "";

  if (setorNorm === "ativos" || /\b(estante|arara|manequim|expositor)\b/.test(text) || firstWord === "ca") {
    return "Mobiliário e Ativos";
  }
  if (setorNorm === "meias" || /\b(meia|meiao|sapatilha pilates)\b/.test(text)) {
    return "Meias e Meiões";
  }
  if (/\b(chuteira|futsal|society|vapor 1[567]|tiempo|phantom|predator|crazyfast|f50)\b/.test(text)) {
    return "Chuteiras";
  }
  if (/\b(chinelo|sandalia|slide|papete|babuche)\b/.test(text)) {
    return "Chinelos e Sandálias";
  }
  if (/\b(bota|coturno|adventure)\b/.test(text) && setorNorm === "calcados") {
    return "Botas e Adventure";
  }
  if (firstWord === "tenis" || setorNorm === "calcados") {
    return "Tênis";
  }
  if (/\b(sunga|maio|biquini|swim|natacao|goggle)\b/.test(text)) {
    return "Natação e Moda Praia";
  }
  if (/\b(camisa|torcedor|torc|jsy|sccp|cruzeiro|flamengo|palmeiras|psg|milao)\b/.test(text) && firstWord !== "camiseta") {
    return "Camisas e Times";
  }
  if (/\b(camiseta|polo|tee|manga curta|manga longa)\b/.test(text) || /\bss\b/.test(modeloNorm)) {
    return "Camisetas e Polos";
  }
  if (/\b(bermuda|shorts|short|calcao|sho)\b/.test(text)) {
    return "Bermudas e Shorts";
  }
  if (/\b(calca|legging)\b/.test(text)) {
    return "Calças e Leggings";
  }
  if (/\b(regata|top|bra|macaquinho|saia|vestido|cropped)\b/.test(text)) {
    return "Regatas, Tops e Saias";
  }
  if (/\b(jaqueta|blusao|moletom|agasalho|conjunto|cortavento|hoodie)\b/.test(text)) {
    return "Jaquetas, Moletons e Conjuntos";
  }
  if (/\b(mochila|bolsa|mala|sacola|pochete|necessaire|gymsack|bkpk|duf)\b/.test(text)) {
    return "Mochilas, Bolsas e Pochetes";
  }
  if (/\b(bone|viseira|gorro|chapeu|cap)\b/.test(text) && setorNorm !== "equipamentos leves") {
    return "Bonés, Viseiras e Gorros";
  }
  if (/\b(bola|luva|caneleira|joelheira|tornozeleira|munhequeira)\b/.test(text)) {
    return "Bolas, Luvas e Proteção";
  }
  if (
    /\b(raquete|beach tennis|oculos|touca|patins|patinete|peso|halter|garrafa|squeeze|toalha|corda|esteira|mola)\b/.test(text) ||
    setorNorm === "equipamentos leves" ||
    setorNorm === "equipamentos pesados"
  ) {
    return "Equipamentos, Raquetes e Fitness";
  }
  if (setorNorm === "vestuario") return "Vestuário (Geral)";
  if (setorNorm === "acessorios") return "Acessórios (Geral)";
  return "Outros";
}

function parseCSV(csvText) {
  const clean = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const lines = clean.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0].trim();
  const delimiter = headerLine.includes(";") && !headerLine.includes(",") ? ";" : ",";
  const headers = splitCSVLine(headerLine, delimiter).map(normalizeText);

  const idx = {
    codigo: headers.findIndex((h) => ["sku", "codigo", "cod", "referencia"].includes(h)),
    nome: headers.findIndex((h) => ["nome", "nome do produto", "produto", "descricao"].includes(h)),
    modelo: headers.findIndex((h) => h === "modelo"),
    marca: headers.findIndex((h) => ["marca", "fabricante"].includes(h)),
    cor: headers.findIndex((h) => ["cor", "cores"].includes(h)),
    tamanho: headers.findIndex((h) => ["tamanho", "tam", "numeracao"].includes(h)),
    setor: headers.findIndex((h) => h === "nivel 1" || h === "setor" || h === "departamento" || h.includes("nivel 1")),
    categoria: headers.findIndex((h) => ["nivel 2", "categoria", "subcategoria", "grupo"].includes(h)),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCSVLine(line, delimiter);
    const codigo = (idx.codigo >= 0 ? cols[idx.codigo] : cols[0] || "").trim();
    if (!codigo) continue;
    rows.push({
      codigo,
      nomeProduto: idx.nome >= 0 ? (cols[idx.nome] || "").trim() : "",
      modelo: idx.modelo >= 0 ? (cols[idx.modelo] || "").trim() : "",
      marca: idx.marca >= 0 ? (cols[idx.marca] || "").trim() : "",
      cor: idx.cor >= 0 ? (cols[idx.cor] || "").trim() : "",
      tamanho: idx.tamanho >= 0 ? (cols[idx.tamanho] || "").trim() : "",
      setor: idx.setor >= 0 ? (cols[idx.setor] || "").trim() : "",
      categoriaExplicita: idx.categoria >= 0 ? (cols[idx.categoria] || "").trim() : "",
    });
  }
  return rows;
}

const csvFiles = fs
  .readdirSync(ROOT_DIR)
  .filter((f) => f.toLowerCase().endsWith(".csv"))
  .sort();

const outPath = path.join(ROOT_DIR, "catalogo.js");

if (csvFiles.length > 0) {
  const mergedMap = new Map();

  for (const fname of csvFiles) {
    const text = fs.readFileSync(path.join(ROOT_DIR, fname), "utf8");
    const rows = parseCSV(text);
    for (const r of rows) {
      const cur = mergedMap.get(r.codigo);
      if (!cur) {
        mergedMap.set(r.codigo, r);
      } else {
        if (!cur.nomeProduto && r.nomeProduto) cur.nomeProduto = r.nomeProduto;
        if (!cur.modelo && r.modelo) cur.modelo = r.modelo;
        if (!cur.marca && r.marca) cur.marca = r.marca;
        if (!cur.cor && r.cor) cur.cor = r.cor;
        if (!cur.tamanho && r.tamanho) cur.tamanho = r.tamanho;
        if (!cur.setor && r.setor) cur.setor = r.setor;
        if (!cur.categoriaExplicita && r.categoriaExplicita) cur.categoriaExplicita = r.categoriaExplicita;
      }
    }
  }

  function makeDict() {
    const map = new Map();
    const list = [];
    return {
      id(val) {
        if (map.has(val)) return map.get(val);
        const idx = list.length;
        list.push(val);
        map.set(val, idx);
        return idx;
      },
      list,
    };
  }

  const dictMarcas = makeDict();
  const dictCores = makeDict();
  const dictTamanhos = makeDict();
  const dictSetores = makeDict();
  const dictCategorias = makeDict();
  const dictPublicos = makeDict();

  const KIDS_VESTUARIO_SIZES = new Set([
    "1", "2", "3", "4", "6", "8", "10", "12", "14", "16",
    "0/1", "2/3", "4/5", "6/7", "8/9",
    "3A4", "4A5", "5A6", "7A8", "9A10", "11A12", "13A14", "15A16",
  ]);

  const KIDS_KEYWORD_RE =
    /\b(infantil|inf|juvenil|juv|jr|junior|kids|kid|baby|bebe|y\s+nk|b\s+nk|g\s+nk|b\s+nsw|g\s+nsw|y\s+nsw|gs|ps|psv|td|tdv)\b/i;

  const FEM_GENERAL_RE =
    /\b(feminin[oa]|fem|mulher|wmns|wms|women|w\s+nk|w\s+nsw|w\s+np)\b/i;
  const FEM_VESTUARIO_RE =
    /\b(legging|saia|vestido|maio|biquini|macaquinho|cropped|top|bra)\b/i;

  const MASC_GENERAL_RE =
    /\b(masculin[oa]|masc|homem|mens|m\s+nk|m\s+nsw|m\s+j|m\s+np|m\s+df)\b/i;
  const MASC_VESTUARIO_RE = /\b(sunga|cueca)\b/i;

  function classifyPublico(setorNorm, nomeNorm, modeloNorm, isInfantil) {
    if (isInfantil) return "Infantil";
    const full = nomeNorm + " " + modeloNorm;

    if (
      FEM_GENERAL_RE.test(full) ||
      (setorNorm === "vestuario" && FEM_VESTUARIO_RE.test(full)) ||
      (setorNorm === "calcados" && /\bw$/.test(modeloNorm))
    ) {
      return "Feminino";
    }

    if (
      MASC_GENERAL_RE.test(full) ||
      (setorNorm === "vestuario" && MASC_VESTUARIO_RE.test(full)) ||
      (setorNorm === "calcados" && /\bm$/.test(modeloNorm))
    ) {
      return "Masculino";
    }

    return "Unissex";
  }

  function detectDirectInfantil(setorNorm, nomeNorm, modeloNorm, tamanhoRaw) {
    const fullNorm = nomeNorm + " " + modeloNorm;
    if (KIDS_KEYWORD_RE.test(fullNorm)) return true;
    if (setorNorm === "calcados" && /\b[jk]$/.test(modeloNorm)) return true;

    const tam = String(tamanhoRaw || "").trim().toUpperCase();
    if (setorNorm === "vestuario" && KIDS_VESTUARIO_SIZES.has(tam)) return true;
    if (setorNorm === "calcados" && /^\d+(\.\d+)?$/.test(tam)) {
      const n = parseFloat(tam);
      if (n >= 14 && n <= 32) return true;
    }
    if (setorNorm === "meias" && /^(16P|19G|21A?|25A?|29A?)$/.test(tam)) return true;
    return false;
  }

  const prepared = [];
  const familyCalcs = new Map();

  for (const raw of mergedMap.values()) {
    let marca = raw.marca;
    if (!marca && raw.nomeProduto) marca = inferBrandFromName(raw.nomeProduto.toUpperCase());

    let nome = raw.nomeProduto;
    if (!nome) {
      const mU = marca.toUpperCase();
      const modU = raw.modelo.toUpperCase();
      nome = marca && raw.modelo && modU.startsWith(mU)
        ? raw.modelo
        : [marca, raw.modelo].filter(Boolean).join(" ") || raw.codigo;
    }

    const modelo = raw.modelo || deriveModelFromProductName(raw.nomeProduto, marca);
    const cor = raw.cor || "-";
    const tamanho = raw.tamanho || "UNI";
    const setor = raw.setor || "OUTROS";
    const setorNorm = normalizeText(setor);
    const nomeNorm = normalizeText(nome);
    const modeloNorm = normalizeText(modelo);
    const categoria = classifyProductCategory(setorNorm, nomeNorm, modeloNorm, raw.categoriaExplicita);
    const isInf = detectDirectInfantil(setorNorm, nomeNorm, modeloNorm, tamanho);

    const base8 = raw.codigo.slice(0, 8).toUpperCase();
    if (setorNorm === "calcados" && /^\d+(\.\d+)?$/.test(tamanho)) {
      const num = parseFloat(tamanho);
      const stat = familyCalcs.get(base8) || { min: Infinity, max: -Infinity, anyInf: false };
      if (num < stat.min) stat.min = num;
      if (num > stat.max) stat.max = num;
      if (isInf) stat.anyInf = true;
      familyCalcs.set(base8, stat);
    }

    prepared.push({
      codigo: raw.codigo,
      base8,
      nome,
      modelo,
      marca: marca || "SEM MARCA",
      cor,
      tamanho,
      setor,
      setorNorm,
      nomeNorm,
      modeloNorm,
      categoria,
      isInf,
    });
  }

  const compactRows = [];
  for (const item of prepared) {
    let isInf = item.isInf;
    if (!isInf && item.setorNorm === "calcados") {
      const stat = familyCalcs.get(item.base8);
      if (stat && stat.anyInf && stat.min <= 31 && stat.max <= 36) {
        isInf = true;
      }
    }
    const publico = classifyPublico(item.setorNorm, item.nomeNorm, item.modeloNorm, isInf);

    compactRows.push([
      item.codigo,
      item.nome,
      item.modelo,
      dictMarcas.id(item.marca),
      dictCores.id(item.cor),
      dictTamanhos.id(item.tamanho),
      dictSetores.id(item.setor),
      dictCategorias.id(item.categoria),
      dictPublicos.id(publico),
    ]);
  }

  const payload = {
    dicts: {
      marcas: dictMarcas.list,
      cores: dictCores.list,
      tamanhos: dictTamanhos.list,
      setores: dictSetores.list,
      categorias: dictCategorias.list,
      publicos: dictPublicos.list,
    },
    items: compactRows,
  };

  const jsOutput =
    "/* Gerado automaticamente por build-data.js (sem dados sensiveis de estoque) */\n" +
    "window.__CATALOGO_UNIFICADO__ = " +
    JSON.stringify(payload) +
    ";\n";

  fs.writeFileSync(outPath, jsOutput, "utf8");
  console.log(`catalogo.js atualizado a partir de ${csvFiles.length} arquivo(s) CSV -> ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
} else if (fs.existsSync(outPath)) {
  console.log("Nenhum CSV na pasta de build — reutilizando catalogo.js existente.");
} else {
  throw new Error("Nenhum arquivo CSV nem catalogo.js encontrado para gerar o build.");
}

// Monta a pasta publica isolada "dist/" para deploy seguro na Vercel
// (nao publica planilhas CSV brutas nem scripts de build)
const DIST_DIR = path.join(ROOT_DIR, "dist");
fs.mkdirSync(DIST_DIR, { recursive: true });

const PUBLIC_ASSETS = [
  "index.html",
  "style.css",
  "app.js",
  "qrcode.js",
  "catalogo.js",
  "logo.svg",
  "manifest.json",
];

for (const asset of PUBLIC_ASSETS) {
  const src = path.join(ROOT_DIR, asset);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST_DIR, asset));
  }
}

console.log(`Pasta dist/ pronta para deploy na Vercel (${PUBLIC_ASSETS.length} arquivos publicos).`);
