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
const zlib = require("zlib");

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
  if (setorNorm === "alimentos" || /\b(nutricao|whey|creatina|barra|gel|isotonic|suplemento|proteina)\b/.test(text)) {
    return "Suplementos e Nutrição";
  }
  if (setorNorm === "insumos" || /\b(embalagem|sacola)\b/.test(text)) {
    return "Insumos e Embalagens";
  }
  if (setorNorm === "meias" || /\b(meia|meiao|sapatilha pilates)\b/.test(text)) {
    return "Meias e Meiões";
  }
  if (/\b(bola|luva|caneleira|joelheira|tornozeleira|munhequeira)\b/.test(text) && setorNorm !== "calcados") {
    return "Bolas, Luvas e Proteção";
  }
  if (
    firstWord === "chuteira" ||
    (setorNorm === "calcados" && /\b(chuteira|futsal|society|vapor 1[567]|tiempo|phantom|predator|crazyfast|f50)\b/.test(text))
  ) {
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

/**
 * Leitor nativo de arquivos Excel (.xlsx) sem dependências externas!
 * Extrai entradas do diretório central ZIP com zlib.inflateRawSync e lê
 * sharedStrings + sheet1.xml ignorando colunas financeiras/quantidades.
 */
function decodeXmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function unzipXlsxEntries(buffer) {
  const entries = new Map();
  // Localiza End of Central Directory (0x06054b50) a partir do final do buffer
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return entries;

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let e = 0; e < totalEntries; e++) {
    if (buffer.readUInt32LE(cdOffset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cdOffset + 10);
    const compSize = buffer.readUInt32LE(cdOffset + 20);
    const nameLen = buffer.readUInt16LE(cdOffset + 28);
    const extraLen = buffer.readUInt16LE(cdOffset + 30);
    const commentLen = buffer.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(cdOffset + 42);
    const fileName = buffer.slice(cdOffset + 46, cdOffset + 46 + nameLen).toString("utf8");

    if (fileName === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/i.test(fileName)) {
      const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const slice = buffer.slice(dataStart, dataStart + compSize);
      const content = method === 8 ? zlib.inflateRawSync(slice) : slice;
      entries.set(fileName, content.toString("utf8"));
    }

    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function excelColIndex(cellRef) {
  if (!cellRef) return -1;
  let col = 0;
  let hasLetters = false;
  for (let i = 0; i < cellRef.length; i++) {
    const code = cellRef.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      col = col * 26 + (code - 64);
      hasLetters = true;
    } else if (code >= 97 && code <= 122) {
      col = col * 26 + (code - 96);
      hasLetters = true;
    } else {
      break;
    }
  }
  return hasLetters ? col - 1 : -1;
}

function cleanSapColor(rawCor) {
  if (!rawCor) return "";
  const stripped = rawCor.replace(/^[0-9A-Z]{1,4}\s*-\s*/i, "").trim().toUpperCase();
  if (!stripped || stripped.startsWith("NAO SE APL")) return "UNICA";
  return stripped;
}

function cleanSapSize(rawTam) {
  if (!rawTam) return "";
  const t = rawTam.trim().toUpperCase();
  if (!t.includes(" - ")) return t;

  const parts = t.split(/\s*-\s*/);
  const code5 = parts[0].trim();
  const desc = (parts.slice(1).join(" ") || "").trim();

  if (desc.startsWith("NAO SE APL") || desc === "UNICO") return "UNI";
  if (desc.startsWith("PEQUENO PE")) return "PP";
  if (desc === "PEQUENO") return "P";
  if (desc === "MEDIO") return "M";
  if (desc.startsWith("GRANDE GRA")) return "GG";
  if (desc === "GRANDE") return "G";
  if (desc.startsWith("EXTRA GRAN")) return "XGG";
  if (/^\d+\s*A\s*\d+$/.test(desc)) return desc.replace(/\s+/g, "");

  // Numerações SAP tipo "00039 - TRINTA E N", "04039 - TRINTA E N", "68010 - DEZ", "00008 - OITO"
  if (/^\d{5}$/.test(code5) && code5[2] === "0") {
    const num = parseInt(code5.slice(3), 10);
    if (num >= 1 && num <= 52) return String(num);
  }
  if (/^\d+(\.\d+)?$/.test(desc)) return desc;
  return desc.slice(0, 8) || "UNI";
}

function cleanSapSectorAndModality(rawGrupo, rawCat) {
  let setor = (rawGrupo || "").trim().toUpperCase();
  let modalidade = (rawCat || "").trim().toUpperCase();
  if (setor.includes(" - ")) {
    const gp = setor.split(/\s*-\s*/);
    if (!modalidade) modalidade = gp[0].trim();
    setor = gp[gp.length - 1].trim();
  }
  if (setor === "ALIMENTO") setor = "ALIMENTOS";
  if (setor === "EQUIPAMENTOS" || setor === "EQUIPAMENTO") setor = "EQUIPAMENTOS LEVES";
  if (setor === "EMBALAGENS" || setor === "EMBALAGEM") setor = "INSUMOS";
  return { setor, modalidade };
}

function parseXLSXFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const xmlMap = unzipXlsxEntries(buf);

  const sharedStrings = [];
  const sharedXml = xmlMap.get("xl/sharedStrings.xml");
  if (sharedXml) {
    const siRegex = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(sharedXml)) !== null) {
      let text = "";
      const tRegex = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(siMatch[1])) !== null) {
        text += decodeXmlEntities(tMatch[1]);
      }
      sharedStrings.push(text);
    }
  }

  const CLASSE_TO_PUBLICO = {
    "0001": "Masculino",
    "0002": "Feminino",
    "0003": "Infantil",
    "0004": "Infantil",
    "0005": "Unissex",
  };

  const GENERO_TO_PUBLICO = {
    MASCULINO: "Masculino",
    FEMININO: "Feminino",
    INFANTIL: "Infantil",
    UNISSEX: "Unissex",
  };

  const allRecords = [];
  const sheetNames = Array.from(xmlMap.keys())
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort();

  for (const sheetKey of sheetNames) {
    const sheetXml = xmlMap.get(sheetKey);
    if (!sheetXml) continue;

    const parsedGrid = [];
    const rowRegex = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
    let rMatch;
    while ((rMatch = rowRegex.exec(sheetXml)) !== null) {
      const rowCells = [];
      const cellRegex = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
      let cMatch;
      let nextSeqIdx = 0;

      while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
        const attrs = cMatch[1] || "";
        const inner = cMatch[2] || "";
        const refMatch = /\br="([A-Za-z]+\d+)"/.exec(attrs);
        const targetCol = refMatch ? excelColIndex(refMatch[1]) : nextSeqIdx;
        const typeMatch = /\bt="([^"]+)"/.exec(attrs);
        const cellType = typeMatch ? typeMatch[1] : "";
        let val = "";

        if (cellType === "inlineStr") {
          const tRegex = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
          let tMatch;
          while ((tMatch = tRegex.exec(inner)) !== null) {
            val += decodeXmlEntities(tMatch[1]);
          }
        } else {
          const vMatch = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
          if (vMatch) {
            const rawV = decodeXmlEntities(vMatch[1]);
            val = cellType === "s" ? sharedStrings[parseInt(rawV, 10)] || "" : rawV;
          }
        }

        rowCells[targetCol] = val.trim();
        nextSeqIdx = targetCol + 1;
      }
      if (rowCells.length > 0) parsedGrid.push(rowCells);
    }

    // Pula abas de resumo dinâmico pequenas (ex.: tabelas dinâmicas de totais)
    if (parsedGrid.length < 2) continue;
    const headers = Array.from(parsedGrid[0], (h) => normalizeText(h || ""));

    const idx = {
      codigo: headers.findIndex((h) => ["cod modelo", "material", "sku", "codigo", "cod", "referencia"].includes(h)),
      nome: headers.findIndex((h) => ["des produto", "descr. material", "descr material", "nome", "nome do produto", "produto", "descricao"].includes(h)),
      setor: headers.findIndex((h) => ["des grupo", "grupo", "nivel 1", "setor", "departamento"].includes(h)),
      subgrupo: headers.findIndex((h) => ["des subgrupo", "subgrupo", "modelo"].includes(h)),
      modalidade: headers.findIndex((h) => ["des categoria", "categoria", "modalidade", "esporte"].includes(h)),
      classe: headers.findIndex((h) => ["des classe", "classe"].includes(h)),
      genero: headers.findIndex((h) => ["genero", "publico"].includes(h)),
      marca: headers.findIndex((h) => ["des marca", "marca", "fabricante"].includes(h)),
      cor: headers.findIndex((h) => ["cor", "cores"].includes(h)),
      tamanho: headers.findIndex((h) => ["tamanho", "tam", "numeracao"].includes(h)),
      ean: headers.findIndex((h) => ["ean", "cod barras", "codigo de barras"].includes(h)),
    };

    // Se a aba não tiver coluna de código/material reconhecível, pula
    if (idx.codigo < 0) continue;

    for (let i = 1; i < parsedGrid.length; i++) {
      const cols = parsedGrid[i];
      const codigo = (cols[idx.codigo] || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6,14}$/.test(codigo) || codigo === "TOTAL") continue;

      const rawClasse = idx.classe >= 0 ? (cols[idx.classe] || "").trim() : "";
      const rawGenero = idx.genero >= 0 ? (cols[idx.genero] || "").trim().toUpperCase() : "";
      const pubFromClasse = CLASSE_TO_PUBLICO[rawClasse] || "";
      const pubFromGenero = GENERO_TO_PUBLICO[rawGenero] || "";
      const publicoExplicito =
        pubFromClasse === "Infantil" ? "Infantil" : pubFromGenero || pubFromClasse;

      const rawGrupo = idx.setor >= 0 ? cols[idx.setor] || "" : "";
      const rawModalidade = idx.modalidade >= 0 ? cols[idx.modalidade] || "" : "";
      const { setor, modalidade } = cleanSapSectorAndModality(rawGrupo, rawModalidade);

      const corLimpa = idx.cor >= 0 ? cleanSapColor(cols[idx.cor] || "") : "";
      const tamLimpo = idx.tamanho >= 0 ? cleanSapSize(cols[idx.tamanho] || "") : "";
      const eanRaw = idx.ean >= 0 ? (cols[idx.ean] || "").replace(/\D+/g, "") : "";

      allRecords.push({
        codigo,
        nomeProduto: idx.nome >= 0 ? (cols[idx.nome] || "").trim() : "",
        marca: idx.marca >= 0 ? (cols[idx.marca] || "").trim() : "",
        cor: corLimpa,
        tamanho: tamLimpo,
        setor,
        subgrupo: idx.subgrupo >= 0 ? (cols[idx.subgrupo] || "").trim() : "",
        modalidade,
        publicoExplicito,
        ean: eanRaw.length >= 8 ? eanRaw : "",
      });
    }
  }

  return allRecords;
}

const DATA_DIRS = [path.join(ROOT_DIR, "planilhas"), ROOT_DIR];

function collectSpreadsheets(ext) {
  const found = [];
  for (const dir of DATA_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(ext) && !f.startsWith("~$"))
      .sort();
    for (const f of files) {
      found.push(path.join(dir, f));
    }
  }
  return found;
}

const csvFiles = collectSpreadsheets(".csv");
const xlsxFiles = collectSpreadsheets(".xlsx");

const outPath = path.join(ROOT_DIR, "catalogo.js");

if (csvFiles.length > 0 || xlsxFiles.length > 0) {
  const mergedMap = new Map();
  const skusByPrefix6 = new Map();

  for (const fullPath of csvFiles) {
    const text = fs.readFileSync(fullPath, "utf8");
    const rows = parseCSV(text);
    for (const r of rows) {
      const cur = mergedMap.get(r.codigo);
      if (!cur) {
        mergedMap.set(r.codigo, r);
        const p6 = r.codigo.slice(0, 6).toUpperCase();
        if (!skusByPrefix6.has(p6)) skusByPrefix6.set(p6, []);
        skusByPrefix6.get(p6).push(r);
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

  // Primeiro processa planilhas .xlsx com SKUs completos (ex.: relatórios SAP de 12 dígitos com EAN/Cor/Tamanho),
  // e por fim processa códigos de referência de 6 dígitos (enriquecendo os de 12 ou criando referência nova).
  const sixDigitModels = [];

  for (const fullPath of xlsxFiles) {
    const xRecords = parseXLSXFile(fullPath);
    for (const xr of xRecords) {
      if (xr.codigo.length === 6) {
        sixDigitModels.push(xr);
        continue;
      }

      // SKU completo vindo do SAP .xlsx (ex.: 12 dígitos)
      const existing = mergedMap.get(xr.codigo);
      if (!existing) {
        const rowObj = {
          codigo: xr.codigo,
          nomeProduto: xr.nomeProduto,
          modelo: "",
          marca: xr.marca,
          cor: xr.cor,
          tamanho: xr.tamanho,
          setor: xr.setor,
          categoriaExplicita: "",
          publicoExplicito: xr.publicoExplicito,
          modalidade: xr.modalidade,
          subgrupo: xr.subgrupo,
          ean: xr.ean,
        };
        mergedMap.set(xr.codigo, rowObj);
        const p6 = xr.codigo.slice(0, 6).toUpperCase();
        if (!skusByPrefix6.has(p6)) skusByPrefix6.set(p6, []);
        skusByPrefix6.get(p6).push(rowObj);
      } else {
        if (!existing.nomeProduto && xr.nomeProduto) existing.nomeProduto = xr.nomeProduto;
        if (!existing.marca && xr.marca) existing.marca = xr.marca;
        if (!existing.cor && xr.cor) existing.cor = xr.cor;
        if (!existing.tamanho && xr.tamanho) existing.tamanho = xr.tamanho;
        if (!existing.setor && xr.setor) existing.setor = xr.setor;
        if (!existing.publicoExplicito && xr.publicoExplicito) existing.publicoExplicito = xr.publicoExplicito;
        if (!existing.modalidade && xr.modalidade) existing.modalidade = xr.modalidade;
        if (!existing.subgrupo && xr.subgrupo) existing.subgrupo = xr.subgrupo;
        if (!existing.ean && xr.ean) existing.ean = xr.ean;
      }
    }
  }

  for (const xm of sixDigitModels) {
    if (skusByPrefix6.has(xm.codigo)) {
      const matchingSkus = skusByPrefix6.get(xm.codigo);
      for (const item of matchingSkus) {
        if (!item.nomeProduto && xm.nomeProduto) item.nomeProduto = xm.nomeProduto;
        if (!item.marca && xm.marca) item.marca = xm.marca;
        if (!item.setor && xm.setor) item.setor = xm.setor;
        if (xm.publicoExplicito && !item.publicoExplicito) item.publicoExplicito = xm.publicoExplicito;
        if (xm.modalidade && !item.modalidade) item.modalidade = xm.modalidade;
      }
    } else if (!mergedMap.has(xm.codigo)) {
      const derivedMod = deriveModelFromProductName(xm.nomeProduto, xm.marca);
      const modeloLabel =
        xm.modalidade && derivedMod !== "-"
          ? derivedMod + " (" + xm.modalidade + ")"
          : derivedMod !== "-"
          ? derivedMod
          : xm.subgrupo || "-";

      mergedMap.set(xm.codigo, {
        codigo: xm.codigo,
        nomeProduto: xm.nomeProduto,
        modelo: modeloLabel,
        marca: xm.marca,
        cor: "Ref. 6 dígitos",
        tamanho: "REF",
        setor: xm.setor,
        categoriaExplicita: "",
        publicoExplicito: xm.publicoExplicito,
        modalidade: xm.modalidade,
        subgrupo: xm.subgrupo,
        ean: "",
      });
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
    const setor = (raw.setor || "OUTROS")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
    const setorNorm = normalizeText(setor);
    if (setorNorm === "ativos") continue;

    const nomeNorm = normalizeText(nome);
    const extraHintsNorm = normalizeText((raw.subgrupo || "") + " " + (raw.modalidade || ""));
    const modeloNorm = normalizeText(modelo);
    const categoria = classifyProductCategory(
      setorNorm,
      (nomeNorm + " " + extraHintsNorm).trim(),
      modeloNorm,
      raw.categoriaExplicita
    );
    if (categoria === "Mobiliário e Ativos") continue;
    const isInf =
      raw.publicoExplicito === "Infantil" ||
      detectDirectInfantil(setorNorm, nomeNorm, modeloNorm, tamanho);

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
      publicoExplicito: raw.publicoExplicito || "",
      ean: raw.ean || "",
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
    const publico =
      isInf
        ? "Infantil"
        : item.publicoExplicito ||
          classifyPublico(item.setorNorm, item.nomeNorm, item.modeloNorm, false);

    const rowOut = [
      item.codigo,
      item.nome,
      item.modelo,
      dictMarcas.id(item.marca),
      dictCores.id(item.cor),
      dictTamanhos.id(item.tamanho),
      dictSetores.id(item.setor),
      dictCategorias.id(item.categoria),
      dictPublicos.id(publico),
    ];
    if (item.ean) rowOut.push(item.ean);
    compactRows.push(rowOut);
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
  console.log(
    `catalogo.js atualizado a partir de ${csvFiles.length} CSV(s) e ${xlsxFiles.length} XLSX(s) -> ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`
  );
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
  "sw.js",
];

for (const asset of PUBLIC_ASSETS) {
  const src = path.join(ROOT_DIR, asset);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST_DIR, asset));
  }
}

console.log(`Pasta dist/ pronta para deploy na Vercel (${PUBLIC_ASSETS.length} arquivos publicos).`);
