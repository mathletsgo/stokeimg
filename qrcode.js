/**
 * ============================================================================
 * GERADOR DE QR CODE PURO (ISO/IEC 18004 — ZERO DEPENDÊNCIAS)
 *
 * Codifica textos/SKUs em Modo Byte com correção de erro Reed-Solomon Nível M
 * (15% de recuperação), seleção automática de Versão (1 a 6) e avaliação real
 * das 8 máscaras oficiais para leitura instantânea em coletores e celulares.
 * ============================================================================
 */
(function (global) {
  "use strict";

  // Tabela de capacidade para Modo Byte com ECC Nível M (bloco único RS em V1..V5, 2 blocos em V6)
  // [version, size, totalDataCodewords, eccPerBlock, numBlocks, alignCenters]
  const VERSION_SPECS_M = [
    null,
    [1, 21, 16, 10, 1, []],
    [2, 25, 28, 16, 1, [6, 18]],
    [3, 29, 44, 26, 1, [6, 22]],
    [4, 33, 64, 18, 2, [6, 26]],
    [5, 37, 86, 24, 2, [6, 30]],
    [6, 41, 108, 16, 4, [6, 34]],
  ];

  // Tabelas de log/exp para corpo finito GF(256) com polinômio 0x11D
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      GF_EXP[i] = GF_EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function buildRsGeneratorPoly(degree) {
    let poly = new Uint8Array([1]);
    for (let i = 0; i < degree; i++) {
      const next = new Uint8Array(poly.length + 1);
      const factor = GF_EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly; // Coeficientes do maior grau (1) ao termo independente
  }

  function computeRsRemainder(dataBytes, eccCount) {
    const gen = buildRsGeneratorPoly(eccCount);
    const rem = new Uint8Array(eccCount);
    for (let i = 0; i < dataBytes.length; i++) {
      const factor = dataBytes[i] ^ rem[0];
      for (let j = 0; j < eccCount - 1; j++) {
        rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
      }
      rem[eccCount - 1] = gfMul(gen[eccCount], factor);
    }
    return rem;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== "undefined") {
      return Array.from(new TextEncoder().encode(String(text)));
    }
    const out = [];
    const str = String(text);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0x80) out.push(code);
      else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return out;
  }

  function selectVersion(byteLen) {
    // Modo Byte em V1..V9: 4 bits modo + 8 bits tamanho = 12 bits (1.5 bytes) de cabeçalho
    for (let v = 1; v < VERSION_SPECS_M.length; v++) {
      const maxDataCodewords = VERSION_SPECS_M[v][2];
      if (byteLen + 2 <= maxDataCodewords) return VERSION_SPECS_M[v];
    }
    throw new Error("Texto muito longo para o gerador de QR Code.");
  }

  function encodeCodewords(bytes, spec) {
    const totalDataCodewords = spec[2];
    const eccPerBlock = spec[3];
    const numBlocks = spec[4];
    const capacityBits = totalDataCodewords * 8;

    const bits = [];
    function pushBits(val, len) {
      for (let i = len - 1; i >= 0; i--) {
        bits.push((val >>> i) & 1);
      }
    }

    // Indicador de Modo Byte (0100) + Contagem de bytes (8 bits)
    pushBits(0b0100, 4);
    pushBits(bytes.length, 8);
    for (let i = 0; i < bytes.length; i++) {
      pushBits(bytes[i], 8);
    }

    // Terminador (até 4 bits zero)
    const termLen = Math.min(4, capacityBits - bits.length);
    pushBits(0, termLen);

    // Alinhamento ao próximo byte
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
      dataCodewords.push(byte);
    }

    // Bytes de preenchimento alternados 0xEC e 0x11
    let padToggle = 0;
    while (dataCodewords.length < totalDataCodewords) {
      dataCodewords.push(padToggle === 0 ? 0xec : 0x11);
      padToggle ^= 1;
    }

    // Divisão em blocos RS e intercalação (interleaving) padrão ISO/IEC 18004
    const dataPerBlock = totalDataCodewords / numBlocks;
    const dataBlocks = [];
    const eccBlocks = [];
    let offset = 0;

    for (let b = 0; b < numBlocks; b++) {
      const blockData = dataCodewords.slice(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      dataBlocks.push(blockData);
      eccBlocks.push(computeRsRemainder(blockData, eccPerBlock));
    }

    const finalCodewords = [];
    for (let i = 0; i < dataPerBlock; i++) {
      for (let b = 0; b < numBlocks; b++) {
        finalCodewords.push(dataBlocks[b][i]);
      }
    }
    for (let i = 0; i < eccPerBlock; i++) {
      for (let b = 0; b < numBlocks; b++) {
        finalCodewords.push(eccBlocks[b][i]);
      }
    }

    return finalCodewords;
  }

  function createBaseMatrix(spec) {
    const size = spec[1];
    const align = spec[5];
    const modules = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    function setFuncModule(r, c, dark) {
      if (r < 0 || r >= size || c < 0 || c >= size) return;
      modules[r][c] = dark ? 1 : 0;
      isFunc[r][c] = 1;
    }

    // Padrões Finder 7x7 + separadores brancos nos 3 cantos
    function placeFinder(topR, leftC) {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const r = topR + dr;
          const c = leftC + dc;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          setFuncModule(r, c, inOuter && (onBorder || inInner));
        }
      }
    }

    placeFinder(0, 0);
    placeFinder(0, size - 7);
    placeFinder(size - 7, 0);

    // Padrões de Alinhamento 5x5 (exceto onde colidem com os 3 Finders)
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        const cr = align[i];
        const cc = align[j];
        if (
          (cr <= 8 && cc <= 8) ||
          (cr <= 8 && cc >= size - 9) ||
          (cr >= size - 9 && cc <= 8)
        ) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dist = Math.max(Math.abs(dr), Math.abs(dc));
            setFuncModule(cr + dr, cc + dc, dist !== 1);
          }
        }
      }
    }

    // Timing patterns (linha 6 e coluna 6)
    for (let i = 8; i < size - 8; i++) {
      if (!isFunc[6][i]) setFuncModule(6, i, i % 2 === 0);
      if (!isFunc[i][6]) setFuncModule(i, 6, i % 2 === 0);
    }

    // Dark module fixo + reserva das áreas de Format Information
    setFuncModule(size - 8, 8, true);

    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        if (!isFunc[8][i]) setFuncModule(8, i, false);
        if (!isFunc[i][8]) setFuncModule(i, 8, false);
      }
    }
    for (let i = 0; i < 8; i++) {
      if (!isFunc[8][size - 1 - i]) setFuncModule(8, size - 1 - i, false);
    }
    for (let i = 0; i < 7; i++) {
      if (!isFunc[size - 1 - i][8]) setFuncModule(size - 1 - i, 8, false);
    }

    return { modules, isFunc, size };
  }

  function placeDataBits(modules, isFunc, size, codewords) {
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let upward = true;

    for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
      if (rightCol === 6) rightCol = 5; // Pula a coluna vertical de timing

      for (let step = 0; step < size; step++) {
        const r = upward ? size - 1 - step : step;
        for (let dx = 0; dx < 2; dx++) {
          const c = rightCol - dx;
          if (!isFunc[r][c]) {
            let dark = 0;
            if (bitIdx < totalBits) {
              dark = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            modules[r][c] = dark;
          }
        }
      }
      upward = !upward;
    }
  }

  function shouldInvertMask(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function writeFormatBits(mat, size, mask) {
    // Nível M em QR Format Info = 00
    const ecFormatBits = 0b00;
    const data5 = (ecFormatBits << 3) | mask;
    let rem = data5 << 10;
    for (let i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    }
    const bits15 = ((data5 << 10) | rem) ^ 0x5412;

    const getBit = (idx) => (bits15 >>> idx) & 1;

    // Cópia superior-esquerda
    const tlCoords = [
      [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
      [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    ];
    for (let i = 0; i < 15; i++) {
      mat[tlCoords[i][0]][tlCoords[i][1]] = getBit(i);
    }

    // Cópia dividida (direita-topo: bits 0..7; esquerda-base: bits 8..14)
    for (let i = 0; i < 8; i++) {
      mat[8][size - 1 - i] = getBit(i);
    }
    for (let i = 8; i < 15; i++) {
      mat[size - 15 + i][8] = getBit(i);
    }
  }

  function computePenaltyScore(mat, size) {
    let penalty = 0;

    // Regra 1: sequências de >= 5 módulos iguais na horizontal e vertical
    for (let r = 0; r < size; r++) {
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (mat[r][c] === mat[r][c - 1]) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty += 1;
        } else {
          runLen = 1;
        }
      }
    }
    for (let c = 0; c < size; c++) {
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (mat[r][c] === mat[r - 1][c]) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty += 1;
        } else {
          runLen = 1;
        }
      }
    }

    // Regra 2: blocos 2x2 da mesma cor
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = mat[r][c];
        if (v === mat[r][c + 1] && v === mat[r + 1][c] && v === mat[r + 1][c + 1]) {
          penalty += 3;
        }
      }
    }

    return penalty;
  }

  /**
   * Gera a matriz 2D booleana (0/1) do QR Code para um texto/SKU.
   */
  function generateMatrix(text) {
    const bytes = utf8Bytes(text);
    const spec = selectVersion(bytes.length);
    const codewords = encodeCodewords(bytes, spec);
    const base = createBaseMatrix(spec);
    placeDataBits(base.modules, base.isFunc, base.size, codewords);

    let bestMat = null;
    let bestScore = Infinity;

    for (let mask = 0; mask < 8; mask++) {
      const candidate = base.modules.map((row) => new Uint8Array(row));
      for (let r = 0; r < base.size; r++) {
        for (let c = 0; c < base.size; c++) {
          if (!base.isFunc[r][c] && shouldInvertMask(mask, r, c)) {
            candidate[r][c] ^= 1;
          }
        }
      }
      writeFormatBits(candidate, base.size, mask);
      const score = computePenaltyScore(candidate, base.size);
      if (score < bestScore) {
        bestScore = score;
        bestMat = candidate;
      }
    }

    return bestMat;
  }

  /**
   * Gera um elemento <svg> vetorial nítido com zona de silêncio (quiet zone = 4 módulos).
   */
  function toSVGString(text, marginModules) {
    const quiet = typeof marginModules === "number" ? marginModules : 4;
    const matrix = generateMatrix(text);
    const n = matrix.length;
    const viewSize = n + quiet * 2;

    let pathData = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          pathData += "M" + (c + quiet) + "," + (r + quiet) + "h1v1h-1z";
        }
      }
    }

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      viewSize +
      " " +
      viewSize +
      '" shape-rendering="crispEdges" role="img" aria-label="QR Code ' +
      String(text).replace(/"/g, "&quot;") +
      '">' +
      '<rect width="100%" height="100%" fill="#ffffff"/>' +
      '<path d="' +
      pathData +
      '" fill="#000000"/>' +
      "</svg>"
    );
  }

  global.QRCodeGenerator = {
    generateMatrix,
    toSVGString,
  };
})(typeof window !== "undefined" ? window : globalThis);
