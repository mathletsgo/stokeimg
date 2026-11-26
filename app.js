/**
 * ============================================================================
 * BUSCA INTELIGENTE DE PRODUTOS (MODO GRADE, PÚBLICO & FIXADOS DE BALCÃO)
 *
 * Funcionalidades:
 * 1. Modo Grade: agrupa variações do mesmo modelo/cor (8 primeiros dígitos do SKU)
 *    num único card com botões de tamanho clicáveis que trocam o SKU e o QR Code na hora.
 * 2. Classificação e Filtro de Público (Infantil, Feminino, Masculino, Unissex) com
 *    tags coloridas visuais nos cards.
 * 3. Fixados (Itens de Balcão ★) e Últimos Consultados salvos em localStorage na
 *    tela inicial para acesso de 1 toque sem exibir produtos aleatórios ao entrar.
 * 4. Seta retrátil de filtros + recolhimento automático ao rolar a tela + sigilo
 *    absoluto de quantidades totais e de SKUs nos filtros.
 * ============================================================================
 */

(function () {
  "use strict";

  const CSV_FALLBACK_FILES = [];

  const CENTAURO_IMG_BASE = "https://imgcentauro-a.akamaihd.net/768x768/";
  const DEBOUNCE_MS = 250;
  const STORAGE_PINNED_KEY = "cent_sku_pinned_v1";
  const STORAGE_RECENT_KEY = "cent_sku_recent_v1";
  const STORAGE_GROUP_MODE_KEY = "cent_sku_group_mode_v1";
  const STORAGE_THEME_KEY = "cent_sku_theme_v1";
  const STORAGE_LAST_SUGGESTIONS_KEY = "cent_sku_last_suggestions_v1";
  const STORAGE_RECENT_SEARCHES_KEY = "cent_sku_recent_searches_v1";
  const MAX_RECENT_ITEMS = 4;
  const MAX_RECENT_SEARCHES = 6;

  const QUICK_SUGGESTIONS_POOL = [
    "camiseta nike azul M",
    "tenis adidas feminino",
    "chuteira infantil",
    "bermuda oxer G",
    "tenis nike masculino",
    "legging feminina preta",
    "mochila nike preta",
    "meia adidas",
    "jaqueta puma masculina",
    "camisa flamengo",
    "tenis olympikus feminino",
    "tenis asics masculino",
    "chuteira futsal nike",
    "chinelo adidas slide",
    "bone nike preto",
    "bola de futebol penalty",
    "regata oxer feminina",
    "short nike masculino",
    "tenis mizuno masculino",
    "tenis fila feminino",
    "blusao moletom adidas",
    "camiseta under armour",
    "calca jogger oxer",
    "tenis infantil masculino",
  ];

  function getBatchSize() {
    return typeof window !== "undefined" && window.innerWidth < 860 ? 24 : 48;
  }

  /**
   * CACHE EM MEMÓRIA DE IMAGENS (requisito obrigatório)
   * Mapeia: codigo (SKU) -> URL válida resolvida (ou "__NO_IMAGE__").
   */
  const imageCache = {};

  let allProducts = [];
  let productBySku = new Map();
  let siblingsByBase8 = new Map();
  let siblingsByBase6 = new Map();
  let autocompleteIndex = [];
  let currentDropdownItems = [];
  let activeDropdownIdx = -1;
  let originalTypedQuery = "";
  let currentGhostRest = "";
  let displayEntries = []; // No Modo Grade: [{ variants, defaultVariant }] | Individual: [{ variants:[p], defaultVariant:p }]
  let renderedCount = 0;
  let isGroupMode = true;
  let pinnedSkus = [];
  let recentSkus = [];
  let recentSearches = [];
  let debounceTimer = null;
  let toastTimer = null;
  let scrollObserver = null;
  let activeQrProduct = null;
  let activeModalTab = "qr";
  let qrZoomScale = 1;
  let screenWakeLock = null;
  let modalHistoryPushed = false;
  let deferredInstallPrompt = null;
  let isFiltersDrawerOpen = false;
  let lastScrollY = 0;
  let ignoreScrollUntil = 0;

  const STORE_SYNONYMS = {
    fut: ["futsal"],
    soc: ["society"],
    masc: ["masculino"],
    fem: ["feminino"],
    inf: ["infantil"],
    juv: ["infantil"],
    pb: ["preto", "branco"],
    cj: ["conjunto"],
    chut: ["chuteira"],
    berm: ["bermuda"],
    cam: ["camiseta"],
    molet: ["moletom"],
  };

  function expandStoreSynonyms(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const mapped = STORE_SYNONYMS[tok];
      if (mapped) {
        for (let m = 0; m < mapped.length; m++) out.push(mapped[m]);
      } else {
        out.push(tok);
      }
    }
    return out;
  }

  const els = {
    topHeader: document.getElementById("top-header"),
    brandHomeLink: document.getElementById("brand-home-link"),
    offlineBadge: document.getElementById("offline-badge"),
    installPwaBtn: document.getElementById("install-pwa-btn"),
    themeToggleBtn: document.getElementById("theme-toggle-btn"),
    metaThemeColor: document.getElementById("meta-theme-color"),
    toggleGroupModeBtn: document.getElementById("toggle-group-mode-btn"),
    searchForm: document.getElementById("search-form"),
    searchInput: document.getElementById("search-input"),
    searchGhostTyped: document.getElementById("search-ghost-typed"),
    searchGhostRest: document.getElementById("search-ghost-rest"),
    voiceSearchBtn: document.getElementById("voice-search-btn"),
    clearSearchBtn: document.getElementById("clear-search-btn"),
    recentSearchesDropdown: document.getElementById("recent-searches-dropdown"),
    recentSearchesHeader: document.getElementById("recent-searches-header"),
    recentSearchesList: document.getElementById("recent-searches-list"),
    clearRecentSearchesBtn: document.getElementById("clear-recent-searches-btn"),
    toggleFiltersBtn: document.getElementById("toggle-filters-btn"),
    activeFilterDot: document.getElementById("active-filter-dot"),
    filtersDrawer: document.getElementById("filters-drawer"),
    collapseDrawerUpBtn: document.getElementById("collapse-drawer-up-btn"),
    sectorQuickChips: document.getElementById("sector-quick-chips"),
    sectorFilter: document.getElementById("filter-sector"),
    publicoFilter: document.getElementById("filter-publico"),
    categoryFilter: document.getElementById("filter-category"),
    brandFilter: document.getElementById("filter-brand"),
    sizeFilter: document.getElementById("filter-size"),
    colorFilter: document.getElementById("filter-color"),
    resetFiltersBtn: document.getElementById("reset-filters-btn"),
    activeStatusBar: document.getElementById("active-status-bar"),
    activeFiltersSummary: document.getElementById("active-filters-summary"),
    approxBadge: document.getElementById("approx-badge"),
    quickClearAllBtn: document.getElementById("quick-clear-all-btn"),
    productsGrid: document.getElementById("products-grid"),
    homeHub: document.getElementById("home-hub"),
    pinnedSection: document.getElementById("pinned-section"),
    pinnedList: document.getElementById("pinned-list"),
    recentSection: document.getElementById("recent-section"),
    recentList: document.getElementById("recent-list"),
    clearRecentBtn: document.getElementById("clear-recent-btn"),
    emptyState: document.getElementById("empty-state"),
    stateIconSearch: document.getElementById("state-icon-search"),
    emptyTitle: document.getElementById("empty-title"),
    emptyDesc: document.getElementById("empty-desc"),
    quickSuggestions: document.getElementById("quick-suggestions"),
    loadMoreWrap: document.getElementById("load-more-wrap"),
    loadMoreBtn: document.getElementById("load-more-btn"),
    scrollSentinel: document.getElementById("scroll-sentinel"),
    scrollTopSearchBtn: document.getElementById("scroll-top-search-btn"),
    importCsvBtn: document.getElementById("import-csv-btn"),
    csvFileInput: document.getElementById("csv-file-input"),
    qrModal: document.getElementById("qr-modal"),
    qrModalPinBtn: document.getElementById("qr-modal-pin-btn"),
    qrModalClose: document.getElementById("qr-modal-close"),
    modalTabQr: document.getElementById("modal-tab-qr"),
    modalTabPhoto: document.getElementById("modal-tab-photo"),
    modalQrPanel: document.getElementById("modal-qr-panel"),
    modalPhotoPanel: document.getElementById("modal-photo-panel"),
    modalPhotoBox: document.getElementById("modal-photo-box"),
    qrCanvasBox: document.getElementById("qr-canvas-box"),
    qrZoomLabel: document.getElementById("qr-zoom-label"),
    qrZoomResetBtn: document.getElementById("qr-zoom-reset-btn"),
    qrModalSkuBtn: document.getElementById("qr-modal-sku-btn"),
    qrModalSkuCode: document.getElementById("qr-modal-sku-code"),
    qrModalTitle: document.getElementById("qr-modal-title"),
    qrModalMeta: document.getElementById("qr-modal-meta"),
    qrModalVariants: document.getElementById("qr-modal-variants"),
    qrModalColorsRow: document.getElementById("qr-modal-colors-row"),
    qrModalColorsList: document.getElementById("qr-modal-colors-list"),
    qrModalSizesRow: document.getElementById("qr-modal-sizes-row"),
    qrModalSizesList: document.getElementById("qr-modal-sizes-list"),
    qrCentauroLink: document.getElementById("qr-centauro-link"),
    qrShareBtn: document.getElementById("qr-share-btn"),
    qrDownloadBtn: document.getElementById("qr-download-btn"),
    copyToast: document.getElementById("copy-toast"),
  };

  /**
   * ==========================================================================
   * 1. PERSISTÊNCIA LOCAL (FIXADOS DE BALCÃO & ÚLTIMOS CONSULTADOS)
   * ==========================================================================
   */

  function readStorageJson(key, fallback) {
    try {
      const raw = window.localStorage ? window.localStorage.getItem(key) : null;
      return raw ? JSON.parse(raw) : fallback;
    } catch (_e) {
      return fallback;
    }
  }

  function writeStorageJson(key, value) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (_e) {
      // Ignorado caso modo anônimo bloqueie escrita
    }
  }

  function loadUserPreferences() {
    const savedPinned = readStorageJson(STORAGE_PINNED_KEY, []);
    pinnedSkus = Array.isArray(savedPinned) ? savedPinned : [];

    const savedRecent = readStorageJson(STORAGE_RECENT_KEY, []);
    recentSkus = Array.isArray(savedRecent) ? savedRecent.slice(0, MAX_RECENT_ITEMS) : [];

    const savedSearches = readStorageJson(STORAGE_RECENT_SEARCHES_KEY, []);
    recentSearches = Array.isArray(savedSearches) ? savedSearches.filter((s) => typeof s === "string" && s.trim()) : [];

    const savedMode = readStorageJson(STORAGE_GROUP_MODE_KEY, true);
    isGroupMode = savedMode !== false;
    syncGroupModeButton();
  }

  function syncGroupModeButton() {
    if (!els.toggleGroupModeBtn) return;
    els.toggleGroupModeBtn.classList.toggle("is-active", isGroupMode);
    els.toggleGroupModeBtn.setAttribute("aria-pressed", isGroupMode ? "true" : "false");
    els.toggleGroupModeBtn.textContent = isGroupMode ? "Grade: ON" : "Grade: OFF";
  }

  function isSkuPinned(codigo) {
    return pinnedSkus.indexOf(codigo) !== -1;
  }

  function togglePinSku(codigo) {
    const idx = pinnedSkus.indexOf(codigo);
    if (idx >= 0) {
      pinnedSkus.splice(idx, 1);
    } else {
      pinnedSkus.unshift(codigo);
    }
    writeStorageJson(STORAGE_PINNED_KEY, pinnedSkus);
    renderHomeHubLists();
    return idx === -1;
  }

  function recordRecentSku(codigo) {
    if (!codigo) return;
    recentSkus = [codigo].concat(recentSkus.filter((s) => s !== codigo)).slice(0, MAX_RECENT_ITEMS);
    writeStorageJson(STORAGE_RECENT_KEY, recentSkus);
  }

  function recordRecentSearch(rawQuery) {
    const clean = String(rawQuery || "").trim().replace(/\s+/g, " ");
    if (clean.length < 2) return;
    const normNew = normalizeText(clean);
    recentSearches = [clean]
      .concat(recentSearches.filter((q) => normalizeText(q) !== normNew))
      .slice(0, MAX_RECENT_SEARCHES);
    writeStorageJson(STORAGE_RECENT_SEARCHES_KEY, recentSearches);
  }

  function clearGhostCompletion() {
    currentGhostRest = "";
    if (els.searchGhostTyped) els.searchGhostTyped.textContent = "";
    if (els.searchGhostRest) els.searchGhostRest.textContent = "";
  }

  function updateGhostCompletion(rawVal, candidateText) {
    if (!els.searchGhostTyped || !els.searchGhostRest || !els.searchInput) return;
    if (
      !rawVal ||
      !candidateText ||
      document.activeElement !== els.searchInput ||
      els.searchInput.scrollLeft > 0 ||
      rawVal.length >= candidateText.length
    ) {
      clearGhostCompletion();
      return;
    }

    const rawLower = rawVal.toLowerCase();
    const candLower = candidateText.toLowerCase();
    if (candLower.indexOf(rawLower) === 0) {
      const rest = candidateText.slice(rawVal.length);
      currentGhostRest = rest;
      els.searchGhostTyped.textContent = rawVal;
      els.searchGhostRest.textContent = rest;
    } else {
      clearGhostCompletion();
    }
  }

  function hideRecentSearchesDropdown() {
    activeDropdownIdx = -1;
    currentDropdownItems = [];
    clearGhostCompletion();
    if (els.recentSearchesDropdown) {
      els.recentSearchesDropdown.hidden = true;
    }
  }

  const AUTOCOMPLETE_NOISE_WORDS = new Set([
    "m", "w", "b", "g", "y", "u", "jr", "nk", "nsw", "df", "np", "ls", "ss",
    "jsy", "torc", "tor", "sho", "bkpk", "ca", "de", "da", "do", "com", "em", "p", "c",
  ]);

  function cleanPhraseWords(str, maxWords) {
    const norm = normalizeText(str);
    if (!norm) return "";
    const parts = norm.split(" ").filter((w) => w.length >= 2 && !AUTOCOMPLETE_NOISE_WORDS.has(w));
    return parts.slice(0, maxWords).join(" ");
  }

  function buildAutocompleteIndex() {
    const freqMap = new Map();

    const addPhrase = function (rawPhrase, weight) {
      const clean = String(rawPhrase || "").trim().replace(/\s+/g, " ");
      if (clean.length < 4) return;
      const prev = freqMap.get(clean) || 0;
      freqMap.set(clean, prev + weight);
    };

    for (const group of siblingsByBase8.values()) {
      const p = group[0];
      if (!p) continue;
      const w = Math.min(group.length, 8);

      const nomeNorm = normalizeText(p.nome);
      const nomeWords = nomeNorm.split(" ").filter((tok) => tok.length >= 2 && !AUTOCOMPLETE_NOISE_WORDS.has(tok));
      const firstType = nomeWords[0] || "";
      const marcaNorm = p.marca && p.marca !== "SEM MARCA" ? normalizeText(p.marca) : "";
      const pubNorm = p.publico && p.publico !== "Unissex" ? normalizeText(p.publico) : "";
      const corFirst = p.cor && p.cor !== "-" ? normalizeText(p.cor).split(" ")[0] : "";

      if (firstType && firstType.length >= 3) {
        if (marcaNorm) {
          addPhrase(firstType + " " + marcaNorm, w * 3);
          if (pubNorm) addPhrase(firstType + " " + marcaNorm + " " + pubNorm, w * 2);
          if (corFirst && corFirst.length >= 3) addPhrase(firstType + " " + marcaNorm + " " + corFirst, w * 2);
        }
        if (pubNorm) {
          addPhrase(firstType + " " + pubNorm, w * 2);
        }
      }

      const shortTitle = cleanPhraseWords(p.nome, 4);
      if (shortTitle && shortTitle.split(" ").length >= 2) {
        addPhrase(shortTitle, w);
      }
    }

    const entries = [];
    for (const [phrase, weight] of freqMap.entries()) {
      entries.push({
        phrase,
        tokens: phrase.split(" "),
        weight,
      });
    }

    entries.sort((a, b) => b.weight - a.weight || a.phrase.localeCompare(b.phrase, "pt-BR"));
    autocompleteIndex = entries;
  }

  function getGoogleStyleSuggestions(rawQuery) {
    const trimmed = String(rawQuery || "").trim();
    const normQ = normalizeText(trimmed);
    if (!normQ) return [];

    const qTokens = normQ.split(" ").filter(Boolean);
    const seen = new Set();
    const results = [];
    const MAX_SUGGESTIONS = 7;

    // 1. Buscas recentes do próprio usuário que combinam com o que está sendo digitado
    for (let i = 0; i < recentSearches.length && results.length < 2; i++) {
      const r = recentSearches[i];
      const rNorm = normalizeText(r);
      if (rNorm && rNorm !== normQ && rNorm.indexOf(normQ) === 0 && !seen.has(rNorm)) {
        seen.add(rNorm);
        results.push({ text: r.toLowerCase(), subtitle: "", isRecent: true });
      }
    }

    // 2. Se estiver digitando números/código (>= 3 caracteres com dígitos), sugere SKUs/referências reais
    const compactQ = normQ.replace(/\s+/g, "");
    if (compactQ.length >= 3 && /\d/.test(compactQ)) {
      for (const group of siblingsByBase8.values()) {
        if (results.length >= MAX_SUGGESTIONS) break;
        const p = group[0];
        if (!p) continue;
        if (p.codigoBase8.indexOf(compactQ) === 0 || p.codigoNorm.indexOf(compactQ) === 0) {
          const codeKey = group.length > 1 ? p.codigoBase8.toUpperCase() : p.codigo;
          const normKey = codeKey.toLowerCase();
          if (!seen.has(normKey)) {
            seen.add(normKey);
            const shortName = p.nome.length > 28 ? p.nome.slice(0, 26) + "…" : p.nome;
            results.push({
              text: codeKey,
              subtitle: shortName + (p.cor && p.cor !== "-" ? " • " + p.cor : ""),
              isRecent: false,
            });
          }
        }
      }
    }

    // 3. Sugestões por prefixo direto estilo Google (ex.: "camiseta ni" -> "camiseta nike")
    for (let i = 0; i < autocompleteIndex.length && results.length < MAX_SUGGESTIONS; i++) {
      const entry = autocompleteIndex[i];
      if (entry.phrase !== normQ && entry.phrase.indexOf(normQ) === 0 && !seen.has(entry.phrase)) {
        seen.add(entry.phrase);
        results.push({ text: entry.phrase, subtitle: "", isRecent: false });
      }
    }

    // 4. Sugestões por palavras em qualquer ordem (ex.: "nike ten" -> "tenis nike")
    if (results.length < MAX_SUGGESTIONS && qTokens.length >= 1) {
      for (let i = 0; i < autocompleteIndex.length && results.length < MAX_SUGGESTIONS; i++) {
        const entry = autocompleteIndex[i];
        if (seen.has(entry.phrase) || entry.phrase === normQ) continue;
        let allMatch = true;
        for (let t = 0; t < qTokens.length; t++) {
          const qt = qTokens[t];
          let matchedWord = false;
          for (let w = 0; w < entry.tokens.length; w++) {
            if (entry.tokens[w].indexOf(qt) === 0) {
              matchedWord = true;
              break;
            }
          }
          if (!matchedWord) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          seen.add(entry.phrase);
          results.push({ text: entry.phrase, subtitle: "", isRecent: false });
        }
      }
    }

    return results;
  }

  function formatAutocompleteHtml(suggestionText, rawQuery) {
    const cleanQ = String(rawQuery || "").trim();
    if (!cleanQ) return escapeHtml(suggestionText);
    const sLower = suggestionText.toLowerCase();
    const qLower = cleanQ.toLowerCase();

    // Estilo Google clássico: trecho já digitado normal + continuação sugerida em negrito
    if (sLower.indexOf(qLower) === 0) {
      const typedPart = suggestionText.slice(0, cleanQ.length);
      const completedPart = suggestionText.slice(cleanQ.length);
      return escapeHtml(typedPart) + "<strong>" + escapeHtml(completedPart) + "</strong>";
    }

    return "<strong>" + escapeHtml(suggestionText) + "</strong>";
  }

  function syncDropdownHighlight() {
    if (!els.recentSearchesList) return;
    const children = els.recentSearchesList.children;
    for (let i = 0; i < children.length; i++) {
      children[i].classList.toggle("is-highlighted", i === activeDropdownIdx);
    }
  }

  function renderSearchDropdown() {
    if (!els.recentSearchesDropdown || !els.recentSearchesList || !els.searchInput) return;
    const rawVal = els.searchInput.value || "";
    const trimmedVal = rawVal.trim();
    activeDropdownIdx = -1;

    // Caso 1: Barra vazia -> exibe Histórico de Buscas Recentes
    if (trimmedVal.length === 0) {
      clearGhostCompletion();
      if (recentSearches.length === 0) {
        els.recentSearchesDropdown.hidden = true;
        currentDropdownItems = [];
        return;
      }

      if (els.recentSearchesHeader) els.recentSearchesHeader.hidden = false;
      els.recentSearchesList.innerHTML = "";
      currentDropdownItems = recentSearches.slice();
      const frag = document.createDocumentFragment();

      for (let i = 0; i < recentSearches.length; i++) {
        const term = recentSearches[i];
        const row = document.createElement("div");
        row.className = "recent-search-item";

        const selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.className = "recent-search-select-btn";
        selectBtn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="9"></circle>' +
          '<polyline points="12 7 12 12 15 15"></polyline>' +
          "</svg>" +
          '<span class="recent-search-text">' +
          escapeHtml(term) +
          "</span>";

        selectBtn.addEventListener("click", function () {
          els.searchInput.value = term;
          recordRecentSearch(term);
          hideRecentSearchesDropdown();
          if (debounceTimer) clearTimeout(debounceTimer);
          executeSearch(false);
          els.searchInput.blur();
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "recent-search-remove-btn";
        removeBtn.setAttribute("aria-label", "Remover busca " + term);
        removeBtn.title = "Remover";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          recentSearches = recentSearches.filter((q) => q !== term);
          writeStorageJson(STORAGE_RECENT_SEARCHES_KEY, recentSearches);
          renderSearchDropdown();
        });

        row.appendChild(selectBtn);
        row.appendChild(removeBtn);
        frag.appendChild(row);
      }

      els.recentSearchesList.appendChild(frag);
      els.recentSearchesDropdown.hidden = false;
      return;
    }

    // Caso 2: Digitando -> Autocompletar Inteligente estilo Google!
    const suggestions = getGoogleStyleSuggestions(rawVal);
    currentDropdownItems = suggestions.map((s) => s.text);

    // Atualiza o texto fantasma inline dentro do input se a 1ª sugestão continuar o texto atual
    updateGhostCompletion(rawVal, suggestions.length > 0 ? suggestions[0].text : "");

    if (suggestions.length === 0) {
      els.recentSearchesDropdown.hidden = true;
      return;
    }

    if (els.recentSearchesHeader) els.recentSearchesHeader.hidden = true;
    els.recentSearchesList.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (let i = 0; i < suggestions.length; i++) {
      const item = suggestions[i];
      const row = document.createElement("div");
      row.className = "recent-search-item";

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "recent-search-select-btn";

      const iconSvg = item.isRecent
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 15"></polyline></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

      selectBtn.innerHTML =
        iconSvg +
        '<span class="recent-search-text">' +
        formatAutocompleteHtml(item.text, rawVal) +
        (item.subtitle ? '<span class="recent-search-sub">' + escapeHtml(item.subtitle) + "</span>" : "") +
        "</span>";

      selectBtn.addEventListener("click", function () {
        els.searchInput.value = item.text;
        recordRecentSearch(item.text);
        hideRecentSearchesDropdown();
        if (debounceTimer) clearTimeout(debounceTimer);
        executeSearch(false);
        els.searchInput.blur();
      });

      // Botão estilo Google Mobile (seta diagonal ↖) para jogar o termo na barra e continuar digitando cor/tamanho!
      const fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.className = "autocomplete-fill-btn";
      fillBtn.title = "Completar na barra para continuar digitando";
      fillBtn.setAttribute("aria-label", "Completar " + item.text + " na barra de busca");
      fillBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<line x1="17" y1="17" x2="7" y2="7"></line>' +
        '<polyline points="7 17 7 7 17 7"></polyline>' +
        "</svg>";

      fillBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        els.searchInput.value = item.text + " ";
        originalTypedQuery = els.searchInput.value;
        els.searchInput.focus();
        renderSearchDropdown();
        if (debounceTimer) clearTimeout(debounceTimer);
        executeSearch(false);
      });

      row.appendChild(selectBtn);
      row.appendChild(fillBtn);
      frag.appendChild(row);
    }

    els.recentSearchesList.appendChild(frag);
    els.recentSearchesDropdown.hidden = false;
  }

  /**
   * ==========================================================================
   * 2. NORMALIZAÇÃO, PÚBLICO (FEM/MASC/INF/UNISSEX) E INDEXAÇÃO SOB DEMANDA
   * ==========================================================================
   */

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

  const ABBREV_EXPANSIONS = {
    cla: "claro",
    clar: "claro",
    esc: "escuro",
    masc: "masculino masculina",
    fem: "feminino feminina",
    inf: "infantil",
    juv: "juvenil",
  };

  const MODEL_SUBTYPE_HINTS = {
    tee: ["camiseta", "camisa", "blusa"],
    ss: ["camiseta", "camisa", "manga"],
    jsy: ["camisa", "camiseta"],
    torc: ["camisa", "camiseta", "torcedor"],
    tor: ["camisa", "camiseta", "torcedor"],
    sho: ["short", "bermuda"],
    bkpk: ["mochila", "bolsa"],
    cap: ["bone", "touca"],
  };

  const EMPTY_SET = new Set();
  const SECTOR_SYNONYM_SETS = {
    vestuario: new Set(["roupa", "camiseta", "camisa", "blusa", "bermuda", "short", "calca", "jaqueta", "agasalho", "regata", "top"]),
    calcados: new Set(["tenis", "calcado", "chuteira", "sapato", "chinelo", "sandalia", "sapatilha", "bota"]),
    meias: new Set(["meia", "meiao", "sapatilha"]),
    acessorios: new Set(["acessorio", "mochila", "bone", "bola", "bolsa", "mala", "luva", "garrafa", "squeeze", "pochete"]),
    "equipamentos leves": new Set(["equipamento", "raquete", "oculos", "touca", "natacao", "caneleira", "corda"]),
    "equipamentos pesados": new Set(["equipamento", "patinete", "patins", "peso", "halter", "caneleira", "esteira"]),
  };

  const SECTOR_SHORT_LABELS = {
    VESTUARIO: "Vestuário",
    CALCADOS: "Calçados",
    ACESSORIOS: "Acessórios",
    MEIAS: "Meias",
    ALIMENTOS: "Nutrição",
    "EQUIPAMENTOS LEVES": "Equip. Leves",
    "EQUIPAMENTOS PESADOS": "Equip. Pesados",
    INSUMOS: "Insumos",
  };

  const KNOWN_BRANDS = [
    "NEW BALANCE", "UNDER ARMOUR", "NORD OUTDOOR", "SPIN ROLLER", "ASICS",
    "NIKE", "ADIDAS", "OXER", "PUMA", "OLYMPIKUS", "MIZUNO", "UMBRO",
    "FILA", "ADAMS", "NBA", "BRAZILINE", "BROOKS", "CONVERSE", "SPEEDO",
    "PENALTY", "TOPPER", "REEBOK", "VANS", "CROCS", "HAVAIANAS", "OAKLEY",
    "JORDAN", "COIMBRA", "BEL FIX", "KIKOS", "WILSON", "POKER",
  ];

  const BRAND_ALIASES_IN_NAME = { UA: "UNDER ARMOUR", NB: "NEW BALANCE" };

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

  function detectPublicoRuntime(setorNorm, nomeNorm, modeloNorm, tamanhoRaw) {
    const full = nomeNorm + " " + modeloNorm;
    const tam = String(tamanhoRaw || "").trim().toUpperCase();

    if (
      KIDS_KEYWORD_RE.test(full) ||
      (setorNorm === "calcados" && /\b[jk]$/.test(modeloNorm)) ||
      (setorNorm === "vestuario" && KIDS_VESTUARIO_SIZES.has(tam)) ||
      (setorNorm === "calcados" && /^\d+(\.\d+)?$/.test(tam) && parseFloat(tam) >= 14 && parseFloat(tam) <= 32) ||
      (setorNorm === "meias" && /^(16P|19G|21A?|25A?|29A?)$/.test(tam))
    ) {
      return "Infantil";
    }

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

  function extractCleanWords(normStr) {
    if (!normStr) return [];
    const rawParts = normStr.split(" ").filter(Boolean);
    const out = new Set();
    for (let i = 0; i < rawParts.length; i++) {
      const w = rawParts[i];
      out.add(w);
      if (w.length >= 4 && /^[a-z]+\d+$/.test(w)) {
        out.add(w.replace(/\d+$/, ""));
      }
      if (ABBREV_EXPANSIONS[w]) {
        const exp = ABBREV_EXPANSIONS[w].split(" ");
        for (let j = 0; j < exp.length; j++) out.add(exp[j]);
      }
    }
    return Array.from(out);
  }

  function createLightProduct(codigo, nome, modelo, marca, cor, tamanho, setor, categoria, publico, ean) {
    const codigoNorm = codigo.toLowerCase().trim();
    return {
      codigo,
      nome,
      modelo,
      marca,
      cor,
      tamanho,
      setor,
      categoria,
      publico: publico || "Unissex",
      ean: ean || "",
      codigoNorm,
      codigoBase8: codigoNorm.length > 8 ? codigoNorm.slice(0, 8) : codigoNorm,
      codigoBase6: codigoNorm.length >= 6 ? codigoNorm.slice(0, 6) : codigoNorm,
      _indexed: false,
      nomeNorm: "",
      modeloNorm: "",
      marcaNorm: "",
      corNorm: "",
      tamanhoNorm: "",
      setorNorm: "",
      primaryWords: null,
      nomeWordsSet: null,
      corWordsSet: null,
      semanticSet: null,
      subtypeHints: null,
    };
  }

  function ensureProductIndexed(p) {
    if (p._indexed) return;
    p.nomeNorm = normalizeText(p.nome);
    p.modeloNorm = normalizeText(p.modelo);
    p.marcaNorm = normalizeText(p.marca);
    p.corNorm = normalizeText(p.cor);
    p.tamanhoNorm = normalizeText(p.tamanho);
    p.setorNorm = normalizeText(p.setor);
    const catNorm = normalizeText(p.categoria);

    let publicoTerms = " " + normalizeText(p.publico);
    if (p.publico === "Infantil") publicoTerms += " juvenil kids";
    else if (p.publico === "Feminino") publicoTerms += " feminina mulher";
    else if (p.publico === "Masculino") publicoTerms += " masculina homem";

    p.primaryWords = extractCleanWords(
      [p.nomeNorm, p.modeloNorm, p.marcaNorm, p.corNorm, p.setorNorm, catNorm].join(" ") + publicoTerms
    );
    const nw = extractCleanWords(p.nomeNorm + " " + p.modeloNorm);
    p.nomeWordsSet = new Set(nw);
    p.corWordsSet = new Set(extractCleanWords(p.corNorm));
    p.semanticSet = SECTOR_SYNONYM_SETS[p.setorNorm] || EMPTY_SET;

    let hints = null;
    for (let i = 0; i < nw.length; i++) {
      const list = MODEL_SUBTYPE_HINTS[nw[i]];
      if (list) {
        if (!hints) hints = new Set();
        for (let k = 0; k < list.length; k++) hints.add(list[k]);
      }
    }
    if (p.modeloNorm.indexOf("manga curta") !== -1 || p.modeloNorm.indexOf("manga longa") !== -1) {
      if (!hints) hints = new Set();
      hints.add("camiseta");
      hints.add("camisa");
    }
    p.subtypeHints = hints || EMPTY_SET;
    p._indexed = true;
  }

  /**
   * Reconstrói os mapas de lookup rápido por SKU e por família de grade (8 dígitos).
   */
  function rebuildCatalogLookups() {
    productBySku = new Map();
    siblingsByBase8 = new Map();
    siblingsByBase6 = new Map();

    for (let i = 0; i < allProducts.length; i++) {
      const p = allProducts[i];
      productBySku.set(p.codigo, p);

      let group8 = siblingsByBase8.get(p.codigoBase8);
      if (!group8) {
        group8 = [];
        siblingsByBase8.set(p.codigoBase8, group8);
      }
      group8.push(p);

      if (p.codigoBase6 && p.codigoBase6.length === 6) {
        let group6 = siblingsByBase6.get(p.codigoBase6);
        if (!group6) {
          group6 = [];
          siblingsByBase6.set(p.codigoBase6, group6);
        }
        group6.push(p);
      }
    }

    // Ordena a grade de cada família de produto na sequência natural de tamanhos
    for (const group of siblingsByBase8.values()) {
      if (group.length > 1) {
        group.sort((a, b) => compareSizes(a.tamanho, b.tamanho));
      }
    }

    buildAutocompleteIndex();
  }

  /**
   * ==========================================================================
   * 3. PARSER DE CSV E CARREGAMENTO DA BASE
   * ==========================================================================
   */

  function classifyProductCategory(setorNorm, nomeNorm, modeloNorm, explicitCategory) {
    if (explicitCategory) return explicitCategory;
    const text = (nomeNorm + " " + modeloNorm).trim();
    const firstWord = text.split(" ")[0] || "";

    if (setorNorm === "ativos" || /\b(estante|arara|manequim|expositor)\b/.test(text) || firstWord === "ca") {
      return "Mobiliário e Ativos";
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

  function inferBrandFromName(nomeUpper) {
    if (!nomeUpper) return "";
    for (let i = 0; i < KNOWN_BRANDS.length; i++) {
      const b = KNOWN_BRANDS[i];
      if (nomeUpper.indexOf(" " + b + " ") !== -1 || nomeUpper.endsWith(" " + b) || nomeUpper.startsWith(b + " ")) {
        return b;
      }
    }
    const parts = nomeUpper.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      if (BRAND_ALIASES_IN_NAME[parts[i]]) return BRAND_ALIASES_IN_NAME[parts[i]];
    }
    return "";
  }

  function deriveModelFromProductName(nomeProduto, marca) {
    if (!nomeProduto) return "-";
    let cleaned = nomeProduto
      .trim()
      .replace(
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

  function parseCSVContent(csvText) {
    if (!csvText) return [];
    const cleanText = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
    const lines = cleanText.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headerLine = lines[0].trim();
    const delimiter = headerLine.indexOf(";") !== -1 && headerLine.indexOf(",") === -1 ? ";" : ",";
    const rawHeaders = splitCSVLine(headerLine, delimiter).map(normalizeText);

    const idx = {
      codigo: rawHeaders.findIndex((h) => ["sku", "codigo", "cod", "referencia"].indexOf(h) !== -1),
      nome: rawHeaders.findIndex((h) => ["nome", "nome do produto", "produto", "descricao"].indexOf(h) !== -1),
      modelo: rawHeaders.findIndex((h) => h === "modelo"),
      marca: rawHeaders.findIndex((h) => ["marca", "fabricante"].indexOf(h) !== -1),
      cor: rawHeaders.findIndex((h) => ["cor", "cores"].indexOf(h) !== -1),
      tamanho: rawHeaders.findIndex((h) => ["tamanho", "tam", "numeracao"].indexOf(h) !== -1),
      setor: rawHeaders.findIndex((h) => h === "nivel 1" || h === "setor" || h === "departamento" || h.indexOf("nivel 1") !== -1),
      categoria: rawHeaders.findIndex((h) => ["nivel 2", "categoria", "subcategoria", "grupo"].indexOf(h) !== -1),
    };

    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = splitCSVLine(line, delimiter);
      const codigo = (idx.codigo >= 0 ? cols[idx.codigo] : cols[0] || "").trim();
      if (!codigo) continue;

      records.push({
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
    return records;
  }

  function unifyRawTextsIntoCatalog(rawTexts) {
    const mergedBySku = new Map();

    for (let i = 0; i < allProducts.length; i++) {
      const p = allProducts[i];
      mergedBySku.set(p.codigo, {
        codigo: p.codigo,
        nomeProduto: p.nome,
        modelo: p.modelo === "-" ? "" : p.modelo,
        marca: p.marca === "SEM MARCA" ? "" : p.marca,
        cor: p.cor === "-" ? "" : p.cor,
        tamanho: p.tamanho,
        setor: p.setor,
        categoriaExplicita: p.categoria,
      });
    }

    for (let i = 0; i < rawTexts.length; i++) {
      const parsed = parseCSVContent(rawTexts[i]);
      for (let j = 0; j < parsed.length; j++) {
        const r = parsed[j];
        const cur = mergedBySku.get(r.codigo);
        if (!cur) {
          mergedBySku.set(r.codigo, r);
        } else {
          if (r.nomeProduto) cur.nomeProduto = r.nomeProduto;
          if (r.modelo) cur.modelo = r.modelo;
          if (r.marca) cur.marca = r.marca;
          if (r.cor) cur.cor = r.cor;
          if (r.tamanho) cur.tamanho = r.tamanho;
          if (r.setor) cur.setor = r.setor;
          if (r.categoriaExplicita) cur.categoriaExplicita = r.categoriaExplicita;
        }
      }
    }

    const unified = [];
    for (const raw of mergedBySku.values()) {
      let marca = raw.marca;
      if (!marca && raw.nomeProduto) marca = inferBrandFromName(raw.nomeProduto.toUpperCase());
      let nome = raw.nomeProduto;
      if (!nome) {
        const mU = marca.toUpperCase();
        const modU = raw.modelo.toUpperCase();
        nome =
          marca && raw.modelo && modU.indexOf(mU) === 0
            ? raw.modelo
            : [marca, raw.modelo].filter(Boolean).join(" ") || raw.codigo;
      }
      const modelo = raw.modelo || deriveModelFromProductName(raw.nomeProduto, marca);
      const cor = raw.cor || "-";
      const tamanho = raw.tamanho || "UNI";
      const setor = raw.setor || "OUTROS";
      const setorNorm = normalizeText(setor);
      if (setorNorm === "ativos") continue;
      const nomeNorm = normalizeText(nome);
      const modeloNorm = normalizeText(modelo);
      const categoria = classifyProductCategory(setorNorm, nomeNorm, modeloNorm, raw.categoriaExplicita);
      if (categoria === "Mobiliário e Ativos") continue;
      const publico = detectPublicoRuntime(setorNorm, nomeNorm, modeloNorm, tamanho);

      unified.push(
        createLightProduct(raw.codigo, nome, modelo, marca || "SEM MARCA", cor, tamanho, setor, categoria, publico)
      );
    }

    allProducts = unified;
    rebuildCatalogLookups();
    renderSectorQuickChips();
  }

  async function loadInitialCatalog() {
    const prebuilt = window.__CATALOGO_UNIFICADO__;
    if (prebuilt && Array.isArray(prebuilt.items) && prebuilt.items.length > 0) {
      const d = prebuilt.dicts || {};
      const items = prebuilt.items;
      const loaded = new Array(items.length);

      for (let i = 0; i < items.length; i++) {
        const row = items[i];
        const publico = d.publicos
          ? d.publicos[row[8]]
          : row[8] === 1
          ? "Infantil"
          : "Unissex";

        loaded[i] = createLightProduct(
          row[0],
          row[1],
          row[2],
          d.marcas ? d.marcas[row[3]] : row[3],
          d.cores ? d.cores[row[4]] : row[4],
          d.tamanhos ? d.tamanhos[row[5]] : row[5],
          d.setores ? d.setores[row[6]] : row[6],
          d.categorias ? d.categorias[row[7]] : row[7],
          publico,
          row[9] || ""
        );
      }

      allProducts = loaded;
      rebuildCatalogLookups();
      renderSectorQuickChips();
      return;
    }

    const responses = await Promise.all(CSV_FALLBACK_FILES.map((f) => fetch(encodeURI(f))));
    const valid = responses.filter((r) => r.ok);
    if (valid.length === 0) throw new Error("Nenhum arquivo de catálogo encontrado.");
    const texts = await Promise.all(valid.map((r) => r.text()));
    unifyRawTextsIntoCatalog(texts);
  }

  /**
   * ==========================================================================
   * 4. BUSCA INTELIGENTE + TOLERÂNCIA A ERROS (FUZZY / LEVENSHTEIN)
   * ==========================================================================
   */

  function levenshteinBounded(a, b, maxDist) {
    const lenA = a.length;
    const lenB = b.length;
    if (Math.abs(lenA - lenB) > maxDist) return maxDist + 1;
    if (a === b) return 0;
    if (lenA > lenB) return levenshteinBounded(b, a, maxDist);

    const prev = new Uint16Array(lenA + 1);
    const curr = new Uint16Array(lenA + 1);
    for (let i = 0; i <= lenA; i++) prev[i] = i;

    for (let j = 1; j <= lenB; j++) {
      curr[0] = j;
      let rowMin = curr[0];
      const bChar = b.charCodeAt(j - 1);

      for (let i = 1; i <= lenA; i++) {
        const cost = a.charCodeAt(i - 1) === bChar ? 0 : 1;
        const del = prev[i] + 1;
        const ins = curr[i - 1] + 1;
        const sub = prev[i - 1] + cost;
        let val = del < ins ? del : ins;
        if (sub < val) val = sub;
        curr[i] = val;
        if (val < rowMin) rowMin = val;
      }

      if (rowMin > maxDist) return maxDist + 1;
      for (let i = 0; i <= lenA; i++) prev[i] = curr[i];
    }

    return prev[lenA];
  }

  function scoreTokenAgainstWord(token, word) {
    if (token === word) return 110;
    const tLen = token.length;
    const wLen = word.length;
    if (tLen <= 2) return 0;

    if (wLen > tLen && word.startsWith(token)) return 78;
    if (tLen >= 5 && wLen >= 4 && token.startsWith(word)) return 66;
    if (tLen >= 4 && wLen > tLen && word.indexOf(token) !== -1) return 60;

    if (wLen >= 3) {
      const maxDist = tLen <= 4 ? 1 : 2;
      if (token.charCodeAt(0) === word.charCodeAt(0) || (tLen >= 5 && word.slice(0, 2) === token.slice(0, 2))) {
        const dist = levenshteinBounded(token, word, maxDist);
        if (dist <= maxDist) {
          const maxLen = tLen > wLen ? tLen : wLen;
          if (1 - dist / maxLen >= 0.65) {
            return dist === 1 ? 52 : 44;
          }
        }
      }
    }
    return 0;
  }

  function evaluateProductRelevance(product, queryTokens, compactQuery, wordScoreCaches) {
    if (compactQuery.length >= 4) {
      if (product.codigoNorm === compactQuery || (product.ean && product.ean === compactQuery)) {
        return { matchedCount: queryTokens.length, score: 10000 };
      }
      if (product.codigoBase8 === compactQuery) {
        return { matchedCount: queryTokens.length, score: 9000 };
      }
      if (compactQuery.length === 6 && product.codigoBase6 === compactQuery) {
        return { matchedCount: queryTokens.length, score: 8800 };
      }
    }

    ensureProductIndexed(product);

    let matchedCount = 0;
    let totalScore = 0;

    for (let t = 0; t < queryTokens.length; t++) {
      const token = queryTokens[t];
      const memo = wordScoreCaches[t];
      let bestTokenScore = 0;

      if (product.codigoNorm === token) {
        bestTokenScore = 10000;
      } else if (token.length >= 4 && product.codigoBase8 === token) {
        bestTokenScore = 8500;
      } else if (token.length >= 4 && product.codigoNorm.startsWith(token)) {
        bestTokenScore = 2500;
      } else if (token.length >= 5 && product.codigoNorm.indexOf(token) !== -1) {
        bestTokenScore = 1200;
      }

      if (product.tamanhoNorm === token && 165 > bestTokenScore) {
        bestTokenScore = 165;
      }
      if ((product.corNorm === token || product.marcaNorm === token) && 160 > bestTokenScore) {
        bestTokenScore = 160;
      }

      if (bestTokenScore < 155) {
        const words = product.primaryWords;
        for (let w = 0; w < words.length; w++) {
          const word = words[w];
          let wScore = memo.get(word);
          if (wScore === undefined) {
            wScore = scoreTokenAgainstWord(token, word);
            memo.set(word, wScore);
          }
          if (wScore > 0) {
            let adjusted = wScore;
            if (wScore >= 110) {
              if (product.nomeWordsSet.has(word)) adjusted = 140;
              else if (product.corWordsSet.has(word)) adjusted = 135;
            }
            if (adjusted > bestTokenScore) bestTokenScore = adjusted;
          }
        }
      }

      if (bestTokenScore === 0 && token.length >= 4) {
        if (product.subtypeHints.has(token)) {
          bestTokenScore = 38;
        } else if (product.semanticSet.has(token)) {
          const isShirtQuery = token === "camiseta" || token === "camisa";
          const isOtherGarment =
            isShirtQuery &&
            /\b(legging|bermuda|short|sho|bra|calca|jaqueta)\b/.test(product.nomeNorm + " " + product.modeloNorm);
          bestTokenScore = isOtherGarment ? 12 : 28;
        } else {
          for (const syn of product.semanticSet) {
            if (scoreTokenAgainstWord(token, syn) >= 52) {
              bestTokenScore = 22;
              break;
            }
          }
        }
      }

      if (bestTokenScore > 0) {
        matchedCount++;
        totalScore += bestTokenScore;
      }
    }

    if (queryTokens.length >= 2 && matchedCount === queryTokens.length) {
      const joined = queryTokens.join(" ");
      if (product.nomeNorm.indexOf(joined) !== -1 || product.modeloNorm.indexOf(joined) !== -1) {
        totalScore += 45;
      }
    }

    return { matchedCount, score: totalScore };
  }

  /**
   * ==========================================================================
   * 5. FILTROS EM CASCATA (SETOR, PÚBLICO, CATEGORIA, MARCA, TAMANHO, COR)
   * ==========================================================================
   */

  const APPAREL_SIZE_ORDER = [
    "PP", "P", "P-M", "M", "G", "GG", "GGG", "XGG", "EX", "3GG", "4GG", "G1", "G2", "UNI", "UDE", "OFI",
  ];

  const PUBLICO_ORDER = ["Feminino", "Masculino", "Infantil", "Unissex"];

  function compareSizes(a, b) {
    const idxA = APPAREL_SIZE_ORDER.indexOf(a);
    const idxB = APPAREL_SIZE_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;

    const numA = /^\d+(\.\d+)?$/.test(a) ? parseFloat(a) : NaN;
    const numB = /^\d+(\.\d+)?$/.test(b) ? parseFloat(b) : NaN;
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    if (!isNaN(numA)) return -1;
    if (!isNaN(numB)) return 1;

    return a.localeCompare(b, "pt-BR", { numeric: true });
  }

  function setFiltersDrawerOpen(open) {
    isFiltersDrawerOpen = Boolean(open);
    ignoreScrollUntil = Date.now() + 280;

    if (els.filtersDrawer) {
      els.filtersDrawer.classList.toggle("is-open", isFiltersDrawerOpen);
      els.filtersDrawer.setAttribute("aria-hidden", isFiltersDrawerOpen ? "false" : "true");
    }
    if (els.toggleFiltersBtn) {
      els.toggleFiltersBtn.classList.toggle("is-expanded", isFiltersDrawerOpen);
      els.toggleFiltersBtn.setAttribute("aria-expanded", isFiltersDrawerOpen ? "true" : "false");
    }
  }

  function renderSectorQuickChips() {
    if (!els.sectorQuickChips) return;
    const sectorOrder = [
      "VESTUARIO", "CALCADOS", "ACESSORIOS", "MEIAS",
      "ALIMENTOS", "EQUIPAMENTOS LEVES", "EQUIPAMENTOS PESADOS",
    ];
    const present = new Set();
    for (let i = 0; i < allProducts.length; i++) {
      if (allProducts[i].setor) present.add(allProducts[i].setor);
    }

    const sectors = Array.from(present).sort((a, b) => {
      const ia = sectorOrder.indexOf(a);
      const ib = sectorOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, "pt-BR");
    });

    els.sectorQuickChips.innerHTML = "";
    const frag = document.createDocumentFragment();

    const makeChip = (val, label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sector-chip-btn" + (els.sectorFilter.value === val ? " active" : "");
      btn.dataset.sectorValue = val;
      btn.textContent = label;
      btn.addEventListener("click", function () {
        ignoreScrollUntil = Date.now() + 280;
        els.sectorFilter.value = els.sectorFilter.value === val ? "" : val;
        executeSearch(true);
      });
      return btn;
    };

    frag.appendChild(makeChip("", "Todos"));
    for (let i = 0; i < sectors.length; i++) {
      const s = sectors[i];
      frag.appendChild(makeChip(s, SECTOR_SHORT_LABELS[s] || s));
    }
    els.sectorQuickChips.appendChild(frag);
  }

  function syncSectorChipsActiveState() {
    if (!els.sectorQuickChips) return;
    const cur = els.sectorFilter.value;
    const buttons = els.sectorQuickChips.children;
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      btn.classList.toggle("active", btn.dataset.sectorValue === cur);
    }
  }

  function rebuildSelectOptions(selectEl, defaultLabel, valuesSet, sortFn) {
    if (!selectEl) return;
    const currentValue = selectEl.value;
    if (currentValue) valuesSet.add(currentValue);

    const keys = Array.from(valuesSet).sort(sortFn);
    selectEl.innerHTML = "";

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = defaultLabel;
    selectEl.appendChild(defaultOpt);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      frag.appendChild(opt);
    }
    selectEl.appendChild(frag);
    selectEl.value = currentValue;
    selectEl.classList.toggle("active-filter", Boolean(currentValue));
  }

  function updateFacetedFilters() {
    const selSector = els.sectorFilter.value;
    const selPublico = els.publicoFilter ? els.publicoFilter.value : "";
    const selCategory = els.categoryFilter.value;
    const selBrand = els.brandFilter.value;
    const selSize = els.sizeFilter.value;
    const selColor = els.colorFilter.value;

    const sectorSet = new Set();
    const publicoSet = new Set();
    const categorySet = new Set();
    const brandSet = new Set();
    const sizeSet = new Set();
    const colorSet = new Set();

    for (let i = 0; i < allProducts.length; i++) {
      const p = allProducts[i];
      const okSector = !selSector || p.setor === selSector;
      const okPub = !selPublico || p.publico === selPublico;
      const okCat = !selCategory || p.categoria === selCategory;
      const okBrand = !selBrand || p.marca === selBrand;
      const okSize = !selSize || p.tamanho === selSize;
      const okColor = !selColor || p.cor === selColor;

      if (okPub && okCat && okBrand && okSize && okColor && p.setor) sectorSet.add(p.setor);
      if (okSector && okCat && okBrand && okSize && okColor && p.publico) publicoSet.add(p.publico);
      if (okSector && okPub && okBrand && okSize && okColor && p.categoria) categorySet.add(p.categoria);
      if (okSector && okPub && okCat && okSize && okColor && p.marca && p.marca !== "SEM MARCA") brandSet.add(p.marca);
      if (okSector && okPub && okCat && okBrand && okColor && p.tamanho && p.tamanho !== "-") sizeSet.add(p.tamanho);
      if (okSector && okPub && okCat && okBrand && okSize && p.cor && p.cor !== "-") colorSet.add(p.cor);
    }

    const alphaSort = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true });
    const pubSort = (a, b) => {
      const ia = PUBLICO_ORDER.indexOf(a);
      const ib = PUBLICO_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return alphaSort(a, b);
    };

    rebuildSelectOptions(els.sectorFilter, "Todos os setores", sectorSet, alphaSort);
    rebuildSelectOptions(els.publicoFilter, "Todos os públicos", publicoSet, pubSort);
    rebuildSelectOptions(els.categoryFilter, "Todas as categorias", categorySet, alphaSort);
    rebuildSelectOptions(els.brandFilter, "Todas as marcas", brandSet, alphaSort);
    rebuildSelectOptions(els.sizeFilter, "Todos os tamanhos", sizeSet, compareSizes);
    rebuildSelectOptions(els.colorFilter, "Todas as cores", colorSet, alphaSort);

    syncSectorChipsActiveState();
  }

  /**
   * Converte a lista de SKUs encontrados em entradas de exibição:
   * - Modo Grade ON: agrupa pelo radical de 8 dígitos (modelo+cor), trazendo toda a
   *   grade de tamanhos irmãos e deixando pré-selecionado o tamanho que bateu na busca!
   * - Modo Grade OFF: 1 card individual por SKU.
   */
  function buildDisplayEntries(matchedProducts) {
    if (!isGroupMode) {
      return matchedProducts.map((p) => ({
        variants: [p],
        matchedSet: new Set([p.codigo]),
        defaultVariant: p,
      }));
    }

    const groupsMap = new Map();
    const orderedGroups = [];

    for (let i = 0; i < matchedProducts.length; i++) {
      const p = matchedProducts[i];
      const key = p.codigoBase8;
      let grp = groupsMap.get(key);
      if (!grp) {
        const allSiblings = siblingsByBase8.get(key) || [p];
        grp = {
          variants: allSiblings,
          matchedSet: new Set([p.codigo]),
          defaultVariant: p, // O de maior relevância na busca já vem selecionado!
        };
        groupsMap.set(key, grp);
        orderedGroups.push(grp);
      } else {
        grp.matchedSet.add(p.codigo);
      }
    }

    return orderedGroups;
  }

  function executeSearch(shouldRefreshFacets) {
    if (shouldRefreshFacets) updateFacetedFilters();

    const rawQuery = els.searchInput.value || "";
    const selectedSector = els.sectorFilter.value;
    const selectedPublico = els.publicoFilter ? els.publicoFilter.value : "";
    const selectedCategory = els.categoryFilter.value;
    const selectedBrand = els.brandFilter.value;
    const selectedSize = els.sizeFilter.value;
    const selectedColor = els.colorFilter.value;

    const activeFilterLabels = [
      selectedSector ? SECTOR_SHORT_LABELS[selectedSector] || selectedSector : "",
      selectedPublico,
      selectedCategory,
      selectedBrand,
      selectedSize ? "Tam " + selectedSize : "",
      selectedColor,
    ].filter(Boolean);

    const hasAnyDropdown = activeFilterLabels.length > 0;
    const hasAnyQueryOrFilter = Boolean(rawQuery.trim()) || hasAnyDropdown;

    els.clearSearchBtn.hidden = rawQuery.length === 0;
    els.resetFiltersBtn.hidden = !hasAnyQueryOrFilter;

    if (els.activeFilterDot) els.activeFilterDot.hidden = !hasAnyDropdown;
    if (els.toggleFiltersBtn) els.toggleFiltersBtn.classList.toggle("has-active", hasAnyDropdown);

    const normQuery = normalizeText(rawQuery);
    const compactQuery = normQuery.replace(/\s+/g, "");
    const rawTokens = normQuery ? normQuery.split(" ").filter(Boolean) : [];
    const queryTokens = expandStoreSynonyms(rawTokens);

    // Sem texto na barra de pesquisa: mostra a Tela Inicial com Fixados + Recentes!
    if (queryTokens.length === 0) {
      displayEntries = [];
      renderedCount = 0;
      els.productsGrid.innerHTML = "";
      els.loadMoreWrap.hidden = true;
      els.approxBadge.hidden = true;
      if (els.homeHub) els.homeHub.hidden = false;
      els.emptyState.hidden = false;

      renderHomeHubLists();

      if (els.stateIconSearch) els.stateIconSearch.classList.add("state-icon-brand");
      if (els.quickSuggestions) els.quickSuggestions.hidden = false;

      if (hasAnyDropdown) {
        if (els.activeStatusBar) els.activeStatusBar.hidden = false;
        if (els.activeFiltersSummary) {
          els.activeFiltersSummary.textContent = "Filtros: " + activeFilterLabels.join(" • ");
        }
        els.emptyTitle.textContent = "Filtro selecionado! Agora pesquise na barra";
        els.emptyDesc.textContent =
          "Digite nome, modelo, cor, tamanho ou código acima para localizar os produtos.";
      } else {
        if (els.activeStatusBar) els.activeStatusBar.hidden = true;
        els.emptyTitle.textContent = "Comece digitando na barra acima";
        els.emptyDesc.textContent =
          "Digite nome, modelo, cor, tamanho ou código. Toque em ★ num card para fixar itens de balcão aqui!";
      }
      return;
    }

    const basePool = !hasAnyDropdown
      ? allProducts
      : allProducts.filter((p) => {
          if (selectedSector && p.setor !== selectedSector) return false;
          if (selectedPublico && p.publico !== selectedPublico) return false;
          if (selectedCategory && p.categoria !== selectedCategory) return false;
          if (selectedBrand && p.marca !== selectedBrand) return false;
          if (selectedSize && p.tamanho !== selectedSize) return false;
          if (selectedColor && p.cor !== selectedColor) return false;
          return true;
        });

    const wordScoreCaches = queryTokens.map(() => new Map());
    const exactAllTokenMatches = [];
    const partialTokenMatches = [];
    const minFallbackTokens = Math.max(1, queryTokens.length - 1);

    for (let i = 0; i < basePool.length; i++) {
      const product = basePool[i];
      const { matchedCount, score } = evaluateProductRelevance(
        product,
        queryTokens,
        compactQuery,
        wordScoreCaches
      );

      if (matchedCount === queryTokens.length) {
        exactAllTokenMatches.push({ product, matchedCount, score });
      } else if (queryTokens.length >= 2 && matchedCount >= minFallbackTokens) {
        partialTokenMatches.push({ product, matchedCount, score });
      }
    }

    let chosenResults = exactAllTokenMatches;
    let isApproximate = false;

    if (chosenResults.length === 0 && partialTokenMatches.length > 0) {
      chosenResults = partialTokenMatches;
      isApproximate = true;
    }

    chosenResults.sort((a, b) => {
      if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
      if (b.score !== a.score) return b.score - a.score;
      return a.product.nome.localeCompare(b.product.nome, "pt-BR");
    });

    const matchedProducts = chosenResults.map((entry) => entry.product);
    displayEntries = buildDisplayEntries(matchedProducts);
    els.approxBadge.hidden = !isApproximate;

    if (els.activeStatusBar) {
      if (hasAnyDropdown || isApproximate) {
        els.activeStatusBar.hidden = false;
        els.activeFiltersSummary.textContent = hasAnyDropdown
          ? "Filtros: " + activeFilterLabels.join(" • ")
          : "Exibindo correspondências próximas";
      } else {
        els.activeStatusBar.hidden = true;
      }
    }

    renderInitialBatch();
  }

  /**
   * ==========================================================================
   * 6. IMAGEM PADRÃO CENTAURO — 5 TENTATIVAS DE SKU + CACHE EM MEMÓRIA
   * ==========================================================================
   */

  function getCentauroCandidateUrls(codigo) {
    const sku = String(codigo || "").trim();
    if (!sku) return [];

    let rawAttempts;
    if (sku.length === 8) {
      rawAttempts = [sku];
    } else if (sku.length === 6) {
      // Para códigos de 6 dígitos (referência do modelo sem cor), testa o código puro
      // seguido dos sufixos de cor mais frequentes do padrão Centauro (02=Preto, 31=Preto/Branco, 01=Branco, 05=Marinho...)
      rawAttempts = [
        sku,
        sku + "02",
        sku + "31",
        sku + "01",
        sku + "05",
        sku + "51",
        sku + "07",
        sku + "04",
        sku + "12",
      ];
    } else {
      rawAttempts = [
        sku,
        sku.length > 4 ? sku.slice(0, -4) : "",
        sku.length > 3 ? sku.slice(0, -3) : "",
        sku.length > 2 ? sku.slice(0, -2) : "",
        sku.length > 1 ? sku.slice(0, -1) : "",
      ];
    }

    const seen = new Set();
    const urls = [];
    for (let i = 0; i < rawAttempts.length; i++) {
      const candidate = rawAttempts[i];
      if (candidate && !seen.has(candidate)) {
        seen.add(candidate);
        urls.push(CENTAURO_IMG_BASE + encodeURIComponent(candidate) + ".jpg");
      }
    }
    return urls;
  }

  function applyNoImagePlaceholder(imageBox) {
    imageBox.classList.remove("is-loading");
    imageBox.classList.add("no-image");
    const qrHint = imageBox.querySelector(".qr-hover-badge");
    imageBox.innerHTML = "";

    const placeholder = document.createElement("div");
    placeholder.className = "no-image-placeholder";
    placeholder.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>' +
      '<circle cx="8.5" cy="8.5" r="1.5"></circle>' +
      '<polyline points="21 15 16 10 5 21"></polyline>' +
      '<line x1="3" y1="3" x2="21" y2="21"></line>' +
      "</svg>" +
      "<span>sem imagem</span>";
    imageBox.appendChild(placeholder);
    if (qrHint) imageBox.appendChild(qrHint);
  }

  function attachCentauroImageWithFallback(imageBox, product, isAboveFold) {
    const codigo = product.codigo;
    const cachedValue = imageCache[codigo];

    if (cachedValue === "__NO_IMAGE__") {
      applyNoImagePlaceholder(imageBox);
      return;
    }

    const img = document.createElement("img");
    img.setAttribute("referrerpolicy", "no-referrer");
    img.referrerPolicy = "no-referrer";
    img.loading = isAboveFold ? "eager" : "lazy";
    if (isAboveFold) img.setAttribute("fetchpriority", "high");
    img.decoding = "async";
    img.alt = product.nome + " - " + codigo;
    img.className = "card-img img-hidden";

    const refNode = imageBox.querySelector(".qr-hover-badge") || null;

    if (cachedValue) {
      img.onload = function () {
        imageBox.classList.remove("is-loading");
        img.classList.remove("img-hidden");
      };
      img.onerror = function () {
        delete imageCache[codigo];
        applyNoImagePlaceholder(imageBox);
      };
      img.src = cachedValue;
      imageBox.insertBefore(img, refNode);
      return;
    }

    const candidateUrls = getCentauroCandidateUrls(codigo);
    if (candidateUrls.length === 0) {
      imageCache[codigo] = "__NO_IMAGE__";
      applyNoImagePlaceholder(imageBox);
      return;
    }

    let attemptIndex = 0;

    img.onload = function () {
      imageCache[codigo] = candidateUrls[attemptIndex];
      imageBox.classList.remove("is-loading");
      img.classList.remove("img-hidden");
    };

    img.onerror = function () {
      attemptIndex++;
      if (attemptIndex < candidateUrls.length) {
        img.src = candidateUrls[attemptIndex];
      } else {
        imageCache[codigo] = "__NO_IMAGE__";
        applyNoImagePlaceholder(imageBox);
      }
    };

    img.src = candidateUrls[0];
    imageBox.insertBefore(img, refNode);
  }

  /**
   * ==========================================================================
   * 7. MODAL DE QR CODE + REGISTRO DE ÚLTIMOS CONSULTADOS
   * ==========================================================================
   */

  function syncModalPinState() {
    if (!els.qrModalPinBtn || !activeQrProduct) return;
    const pinned = isSkuPinned(activeQrProduct.codigo);
    els.qrModalPinBtn.classList.toggle("is-pinned", pinned);
    els.qrModalPinBtn.textContent = pinned ? "★" : "☆";
  }

  function setQrZoom(nextScale) {
    const clamped = Math.min(2.2, Math.max(0.55, Math.round(nextScale * 100) / 100));
    qrZoomScale = clamped;
    if (els.qrCanvasBox) {
      els.qrCanvasBox.style.setProperty("--qr-zoom", String(clamped));
    }
    const cardEl = els.qrModal ? els.qrModal.querySelector(".qr-modal-card") : null;
    if (cardEl) {
      cardEl.classList.toggle("is-qr-zoomed", clamped > 1.05);
    }
    const pct = Math.round(clamped * 100);
    if (els.qrZoomLabel) {
      els.qrZoomLabel.textContent =
        pct === 100 ? "Scroll ou pinça p/ zoom (100%)" : "Zoom do QR: " + pct + "%";
    }
    if (els.qrZoomResetBtn) {
      els.qrZoomResetBtn.hidden = pct === 100;
    }
  }

  function renderQrModalVariants(product) {
    if (!els.qrModalVariants) return;

    // 1. Cores disponíveis no mesmo modelo (base 6 dígitos)
    let colorEntries = [];
    if (product.codigoBase6 && product.codigoBase6.length === 6) {
      const allSameModel = siblingsByBase6.get(product.codigoBase6) || [];
      const byBase8 = new Map();
      for (let i = 0; i < allSameModel.length; i++) {
        const item = allSameModel[i];
        if (!byBase8.has(item.codigoBase8)) {
          byBase8.set(item.codigoBase8, item);
        }
      }
      if (byBase8.size > 1) {
        colorEntries = Array.from(byBase8.entries()).map(([base8, sample]) => ({
          base8,
          label: sample.cor && sample.cor !== "-" ? sample.cor : base8.slice(6) || sample.codigo,
        }));
        colorEntries.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      }
    }

    // 2. Tamanhos disponíveis na cor atual (base 8 dígitos)
    const sizeVariants = siblingsByBase8.get(product.codigoBase8) || [product];
    const hasColors = colorEntries.length > 1;
    const hasSizes = sizeVariants.length > 1;

    els.qrModalVariants.hidden = !hasColors && !hasSizes;

    if (els.qrModalColorsRow && els.qrModalColorsList) {
      els.qrModalColorsRow.hidden = !hasColors;
      els.qrModalColorsList.innerHTML = "";
      if (hasColors) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < colorEntries.length; i++) {
          const entry = colorEntries[i];
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "qr-variant-chip" + (entry.base8 === product.codigoBase8 ? " is-selected" : "");
          btn.textContent = entry.label;
          btn.addEventListener("click", function () {
            const targetGroup = siblingsByBase8.get(entry.base8) || [];
            const sameSizeMatch = targetGroup.find((v) => v.tamanho === product.tamanho);
            const nextProd = sameSizeMatch || targetGroup[0];
            if (nextProd) openQrModalForProduct(nextProd, true);
          });
          frag.appendChild(btn);
        }
        els.qrModalColorsList.appendChild(frag);
      }
    }

    if (els.qrModalSizesRow && els.qrModalSizesList) {
      els.qrModalSizesRow.hidden = !hasSizes;
      els.qrModalSizesList.innerHTML = "";
      if (hasSizes) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < sizeVariants.length; i++) {
          const v = sizeVariants[i];
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "qr-variant-chip" + (v.codigo === product.codigo ? " is-selected" : "");
          btn.textContent = v.tamanho;
          btn.title = "Tam " + v.tamanho + " (" + v.codigo + ")";
          btn.addEventListener("click", function () {
            openQrModalForProduct(v, true);
          });
          frag.appendChild(btn);
        }
        els.qrModalSizesList.appendChild(frag);
      }
    }
  }

  async function requestScreenWakeLock() {
    if (!("wakeLock" in navigator) || !navigator.wakeLock) return;
    try {
      if (screenWakeLock) return;
      screenWakeLock = await navigator.wakeLock.request("screen");
      screenWakeLock.addEventListener("release", function () {
        screenWakeLock = null;
      });
    } catch (_e) {
      screenWakeLock = null;
    }
  }

  function releaseScreenWakeLock() {
    if (!screenWakeLock) return;
    try {
      screenWakeLock.release();
    } catch (_e) {}
    screenWakeLock = null;
  }

  function renderModalPhoto(product) {
    if (!els.modalPhotoBox || !product) return;
    els.modalPhotoBox.innerHTML = "";
    els.modalPhotoBox.classList.remove("no-image");
    els.modalPhotoBox.classList.add("is-loading");
    attachCentauroImageWithFallback(els.modalPhotoBox, product, true);
  }

  function setModalViewTab(tab) {
    activeModalTab = tab === "photo" ? "photo" : "qr";
    const isPhoto = activeModalTab === "photo";
    if (els.modalTabQr) {
      els.modalTabQr.classList.toggle("is-active", !isPhoto);
      els.modalTabQr.setAttribute("aria-selected", !isPhoto ? "true" : "false");
    }
    if (els.modalTabPhoto) {
      els.modalTabPhoto.classList.toggle("is-active", isPhoto);
      els.modalTabPhoto.setAttribute("aria-selected", isPhoto ? "true" : "false");
    }
    if (els.modalQrPanel) els.modalQrPanel.hidden = isPhoto;
    if (els.modalPhotoPanel) els.modalPhotoPanel.hidden = !isPhoto;
    if (isPhoto && activeQrProduct) {
      renderModalPhoto(activeQrProduct);
    }
  }

  function openQrModalForProduct(product, preserveZoom, initialTab) {
    if (!els.qrModal || !window.QRCodeGenerator) return;
    const wasHidden = els.qrModal.hidden;
    activeQrProduct = product;
    recordRecentSku(product.codigo);
    if (els.searchInput && els.searchInput.value.trim().length >= 2) {
      recordRecentSearch(els.searchInput.value);
    }

    els.qrCanvasBox.innerHTML = window.QRCodeGenerator.toSVGString(product.codigo, 4);
    if (!preserveZoom) setQrZoom(1);
    els.qrModalSkuCode.textContent = product.codigo;
    els.qrModalTitle.textContent = product.nome;
    els.qrModalMeta.textContent =
      (product.publico !== "Unissex" ? product.publico.toUpperCase() + " • " : "") +
      "Mod: " +
      product.modelo +
      " • " +
      product.cor +
      " • Tam: " +
      product.tamanho;

    els.qrModalSkuBtn.classList.remove("copied");
    const hint = els.qrModalSkuBtn.querySelector(".sku-action-hint");
    if (hint) hint.textContent = "Copiar";
    if (els.qrCentauroLink) {
      const ref6 = String(product.codigo || "").trim().slice(0, 6);
      if (ref6) {
        els.qrCentauroLink.href = "https://www.centauro.com.br/" + encodeURIComponent(ref6);
        els.qrCentauroLink.hidden = false;
      } else {
        els.qrCentauroLink.hidden = true;
      }
    }
    renderQrModalVariants(product);
    syncModalPinState();

    const targetTab = initialTab || (preserveZoom ? activeModalTab : "qr");
    setModalViewTab(targetTab);

    els.qrModal.hidden = false;
    document.body.classList.add("modal-open");
    requestScreenWakeLock();

    if (wasHidden && typeof window.history !== "undefined" && typeof window.history.pushState === "function") {
      try {
        window.history.pushState({ buscaSkuModal: true }, "");
        modalHistoryPushed = true;
      } catch (_e) {
        modalHistoryPushed = false;
      }
    }
  }

  function closeQrModal(fromPopState) {
    if (!els.qrModal || els.qrModal.hidden) return;
    els.qrModal.hidden = true;
    activeQrProduct = null;
    document.body.classList.remove("modal-open");
    releaseScreenWakeLock();

    if (!fromPopState && modalHistoryPushed) {
      modalHistoryPushed = false;
      try {
        window.history.back();
      } catch (_e) {}
    } else {
      modalHistoryPushed = false;
    }

    if ((els.searchInput.value || "").trim() === "") {
      renderHomeHubLists();
    }
  }

  function buildActiveQrCanvas() {
    if (!activeQrProduct || !window.QRCodeGenerator) return null;
    const matrix = window.QRCodeGenerator.generateMatrix(activeQrProduct.codigo);
    const n = matrix.length;
    const quiet = 4;
    const scale = 14;
    const qrSide = (n + quiet * 2) * scale;
    const footerHeight = 96;

    const canvas = document.createElement("canvas");
    canvas.width = qrSide;
    canvas.height = qrSide + footerHeight;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#000000";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.fillText(activeQrProduct.codigo, canvas.width / 2, qrSide + 32);

    ctx.fillStyle = "#4b5563";
    ctx.font = "600 15px sans-serif";
    const shortName =
      activeQrProduct.nome.length > 34
        ? activeQrProduct.nome.slice(0, 31) + "..."
        : activeQrProduct.nome;
    ctx.fillText(
      shortName + " (" + activeQrProduct.tamanho + ")",
      canvas.width / 2,
      qrSide + 64
    );

    return canvas;
  }

  function downloadActiveQrPng() {
    const canvas = buildActiveQrCanvas();
    if (!canvas || !activeQrProduct) return;
    const link = document.createElement("a");
    link.download = "QR-" + activeQrProduct.codigo + ".png";
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function shareActiveQrProduct() {
    if (!activeQrProduct) return;
    const shareText =
      activeQrProduct.nome +
      "\nSKU: " +
      activeQrProduct.codigo +
      " | Cor: " +
      activeQrProduct.cor +
      " | Tam: " +
      activeQrProduct.tamanho;

    if (navigator.share) {
      try {
        const canvas = buildActiveQrCanvas();
        if (canvas && typeof canvas.toBlob === "function") {
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          if (blob && typeof File !== "undefined") {
            const file = new File([blob], "QR-" + activeQrProduct.codigo + ".png", { type: "image/png" });
            if (!navigator.canShare || navigator.canShare({ files: [file] })) {
              await navigator.share({
                title: "BuscaSKU — " + activeQrProduct.codigo,
                text: shareText,
                files: [file],
              });
              return;
            }
          }
        }
        await navigator.share({
          title: "BuscaSKU — " + activeQrProduct.codigo,
          text: shareText,
        });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }

    // Fallback: copia resumo formatado para colar no WhatsApp
    copySkuToClipboard(shareText, null);
    showToast("Resumo do produto copiado p/ colar no WhatsApp!");
  }

  /**
   * ==========================================================================
   * 8. RENDERIZAÇÃO DE CARDS (MODO GRADE + TAGS DE PÚBLICO + PIN ★) E HUB INICIAL
   * ==========================================================================
   */

  function showToast(htmlMessage) {
    if (!els.copyToast) return;
    els.copyToast.innerHTML = htmlMessage;
    els.copyToast.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.copyToast.classList.remove("visible");
    }, 1800);
  }

  async function copySkuToClipboard(codigo, btnEl) {
    recordRecentSku(codigo);
    if (els.searchInput && els.searchInput.value.trim().length >= 2) {
      recordRecentSearch(els.searchInput.value);
    }
    let copiedOk = false;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(codigo);
        copiedOk = true;
      } catch (_e) {
        copiedOk = false;
      }
    }

    if (!copiedOk) {
      const tempArea = document.createElement("textarea");
      tempArea.value = codigo;
      tempArea.setAttribute("readonly", "");
      tempArea.style.position = "fixed";
      tempArea.style.opacity = "0";
      tempArea.style.pointerEvents = "none";
      document.body.appendChild(tempArea);
      tempArea.select();
      try {
        document.execCommand("copy");
      } catch (_err) {
        // Ignorado
      }
      document.body.removeChild(tempArea);
    }

    if (navigator && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(20);
      } catch (_v) {
        // Ignorado
      }
    }

    const hintEl = btnEl ? btnEl.querySelector(".sku-action-hint") : null;
    const originalHint = hintEl ? hintEl.dataset.defaultLabel || "Copiar" : "";
    if (btnEl) {
      btnEl.classList.remove("is-pulsing");
      void btnEl.offsetWidth;
      btnEl.classList.add("copied", "is-pulsing");
    }
    if (hintEl) hintEl.textContent = "✓ Copiado";

    if (btnEl) {
      if (btnEl._copyResetTimer) clearTimeout(btnEl._copyResetTimer);
      btnEl._copyResetTimer = setTimeout(() => {
        btnEl.classList.remove("copied", "is-pulsing");
        if (hintEl) hintEl.textContent = originalHint;
      }, 1500);
    }

    showToast("Código <strong>" + escapeHtml(codigo) + "</strong> copiado!");
  }

  function triggerStarPop(starEl) {
    if (!starEl) return;
    starEl.classList.remove("is-popping");
    void starEl.offsetWidth;
    starEl.classList.add("is-popping");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderHomeMiniCard(product) {
    const row = document.createElement("div");
    row.className = "hub-mini-card";

    const thumb = document.createElement("div");
    thumb.className = "hub-mini-thumb card-image-box is-loading";
    thumb.title = "Toque na foto para abrir o QR Code";
    attachCentauroImageWithFallback(thumb, product, false);
    thumb.addEventListener("click", function () {
      openQrModalForProduct(product);
    });

    const info = document.createElement("div");
    info.className = "hub-mini-info";
    info.innerHTML =
      '<div class="hub-mini-name">' +
      escapeHtml(product.nome) +
      "</div>" +
      '<div class="hub-mini-meta">' +
      (product.publico !== "Unissex" ? escapeHtml(product.publico) + " • " : "") +
      escapeHtml(product.cor) +
      " • Tam: " +
      escapeHtml(product.tamanho) +
      "</div>";

    const actions = document.createElement("div");
    actions.className = "hub-mini-actions";

    const skuBtn = document.createElement("button");
    skuBtn.type = "button";
    skuBtn.className = "hub-sku-btn";
    skuBtn.textContent = product.codigo;
    skuBtn.title = "Toque para copiar o SKU";
    skuBtn.addEventListener("click", function () {
      copySkuToClipboard(product.codigo, skuBtn);
      setTimeout(renderHomeHubLists, 650);
    });

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    const pinned = isSkuPinned(product.codigo);
    pinBtn.className = "hub-pin-btn" + (pinned ? " is-pinned" : "");
    pinBtn.textContent = pinned ? "★" : "☆";
    pinBtn.title = pinned ? "Remover dos fixados" : "Fixar no balcão";
    pinBtn.addEventListener("click", function () {
      const nowPinned = togglePinSku(product.codigo);
      showToast(nowPinned ? "Fixado nos Itens de Balcão ★" : "Removido dos Fixados");
    });

    actions.appendChild(skuBtn);
    actions.appendChild(pinBtn);

    const contentCol = document.createElement("div");
    contentCol.className = "hub-mini-body";
    contentCol.appendChild(info);
    contentCol.appendChild(actions);

    row.appendChild(thumb);
    row.appendChild(contentCol);
    return row;
  }

  function renderHomeHubLists() {
    if (!els.pinnedSection || !els.recentSection || productBySku.size === 0) return;

    // 1. Fixados (Itens de Balcão) com entrada suave em cascata
    const validPinned = pinnedSkus.map((s) => productBySku.get(s)).filter(Boolean);
    els.pinnedSection.hidden = validPinned.length === 0;
    els.pinnedList.innerHTML = "";
    if (validPinned.length > 0) {
      const f = document.createDocumentFragment();
      for (let i = 0; i < validPinned.length; i++) {
        const card = renderHomeMiniCard(validPinned[i]);
        card.style.setProperty("--stagger-delay", Math.min(i, 8) * 35 + "ms");
        f.appendChild(card);
      }
      els.pinnedList.appendChild(f);
    }

    // 2. Últimos Consultados com entrada suave em cascata
    const pinnedSet = new Set(pinnedSkus);
    const validRecent = recentSkus
      .filter((s) => !pinnedSet.has(s))
      .map((s) => productBySku.get(s))
      .filter(Boolean)
      .slice(0, MAX_RECENT_ITEMS);

    els.recentSection.hidden = validRecent.length === 0;
    els.recentList.innerHTML = "";
    if (validRecent.length > 0) {
      const f = document.createDocumentFragment();
      for (let i = 0; i < validRecent.length; i++) {
        const card = renderHomeMiniCard(validRecent[i]);
        card.style.setProperty("--stagger-delay", Math.min(i, 8) * 35 + "ms");
        f.appendChild(card);
      }
      els.recentList.appendChild(f);
    }
  }

  function createProductCard(entry, isAboveFold) {
    let currentVariant = entry.defaultVariant;
    const variants = entry.variants;

    const article = document.createElement("article");
    article.className = "product-card";

    // Bloco Superior: Foto limpa à esquerda (no mobile) + Infos espaçosas à direita
    const topSection = document.createElement("div");
    topSection.className = "card-top-section";

    const imageBox = document.createElement("div");
    imageBox.className = "card-image-box is-loading";
    imageBox.tabIndex = 0;
    imageBox.setAttribute("role", "button");
    imageBox.title = "Toque na foto para exibir o QR Code";

    const qrBadge = document.createElement("span");
    qrBadge.className = "qr-hover-badge";
    qrBadge.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="3" width="7" height="7"></rect>' +
      '<rect x="14" y="3" width="7" height="7"></rect>' +
      '<rect x="3" y="14" width="7" height="7"></rect>' +
      '<rect x="14" y="14" width="3" height="3"></rect>' +
      '<line x1="21" y1="14" x2="21" y2="14.01"></line>' +
      '<line x1="21" y1="21" x2="21" y2="21.01"></line>' +
      '<line x1="14" y1="21" x2="17" y2="21"></line>' +
      "</svg>" +
      "<span>QR</span>";
    imageBox.appendChild(qrBadge);

    attachCentauroImageWithFallback(imageBox, currentVariant, isAboveFold);

    imageBox.addEventListener("click", function () {
      openQrModalForProduct(currentVariant);
    });
    imageBox.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openQrModalForProduct(currentVariant);
      }
    });

    // Coluna de informações ao lado da imagem (no mobile) / abaixo da imagem (no desktop)
    const infoCol = document.createElement("div");
    infoCol.className = "card-info-col";

    // Linha de tags + Botão Estrela (Fixar) alinhado à direita sem apertar o SKU!
    const metaTopRow = document.createElement("div");
    metaTopRow.className = "card-meta-top-row";

    const badgesWrap = document.createElement("div");
    badgesWrap.className = "card-badges-wrap";

    if (currentVariant.publico && currentVariant.publico !== "Unissex") {
      const pubBadge = document.createElement("span");
      pubBadge.className = "publico-tag is-" + currentVariant.publico.toLowerCase();
      pubBadge.textContent = currentVariant.publico;
      badgesWrap.appendChild(pubBadge);
    }

    if (currentVariant.categoria || currentVariant.setor) {
      const catTag = document.createElement("span");
      catTag.className = "category-inline-tag";
      catTag.textContent = currentVariant.categoria || currentVariant.setor;
      badgesWrap.appendChild(catTag);
    }

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "card-pin-btn";

    function refreshPinVisual() {
      const pinned = isSkuPinned(currentVariant.codigo);
      pinBtn.classList.toggle("is-pinned", pinned);
      pinBtn.textContent = pinned ? "★" : "☆";
      pinBtn.title = pinned ? "Remover dos fixados" : "Fixar nos itens de balcão";
    }
    refreshPinVisual();

    pinBtn.addEventListener("click", function () {
      const nowPinned = togglePinSku(currentVariant.codigo);
      refreshPinVisual();
      if (nowPinned) triggerStarPop(pinBtn);
      showToast(nowPinned ? "Fixado nos Itens de Balcão ★" : "Removido dos Fixados");
    });

    metaTopRow.appendChild(badgesWrap);
    metaTopRow.appendChild(pinBtn);

    const titleEl = document.createElement("h2");
    titleEl.className = "product-name";
    titleEl.textContent = currentVariant.nome;

    const detailsList = document.createElement("div");
    detailsList.className = "card-details-lines";
    detailsList.innerHTML =
      '<div class="detail-line"><span class="detail-label">Modelo:</span> <span class="detail-value">' +
      escapeHtml(currentVariant.modelo) +
      "</span></div>" +
      '<div class="detail-line"><span class="detail-label">Cor:</span> <span class="detail-value">' +
      escapeHtml(currentVariant.cor) +
      "</span></div>";

    infoCol.appendChild(metaTopRow);
    infoCol.appendChild(titleEl);
    infoCol.appendChild(detailsList);

    // Indicador rápido de outras cores do mesmo modelo (base 6 dígitos)
    if (currentVariant.codigoBase6 && currentVariant.codigoBase6.length === 6) {
      const sameModel = siblingsByBase6.get(currentVariant.codigoBase6) || [];
      const distinctColors = new Set();
      for (let c = 0; c < sameModel.length; c++) {
        distinctColors.add(sameModel[c].codigoBase8);
      }
      if (distinctColors.size > 1) {
        const extraCount = distinctColors.size - 1;
        const colorsBtn = document.createElement("button");
        colorsBtn.type = "button";
        colorsBtn.className = "card-colors-btn";
        colorsBtn.title = "Ver outras cores disponíveis deste modelo";
        colorsBtn.innerHTML =
          '<span class="card-colors-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          "<span>+" +
          extraCount +
          (extraCount === 1 ? " cor" : " cores") +
          "</span>";
        colorsBtn.addEventListener("click", function () {
          openQrModalForProduct(currentVariant, false, "photo");
        });
        infoCol.appendChild(colorsBtn);
      }
    }

    topSection.appendChild(imageBox);
    topSection.appendChild(infoCol);

    // Bloco Inferior largura total: Botões confortáveis de Tamanho + Barra grande do SKU
    const bottomSection = document.createElement("div");
    bottomSection.className = "card-bottom-section";

    const skuBtn = document.createElement("button");
    skuBtn.type = "button";
    skuBtn.className = "sku-copy-btn";
    const skuValueEl = document.createElement("span");
    skuValueEl.className = "sku-value";
    skuValueEl.textContent = currentVariant.codigo;

    const isRef6 = currentVariant.codigo.length === 6;
    skuBtn.innerHTML =
      '<span class="sku-code-wrap"><span class="sku-label-tiny">' +
      (isRef6 ? "Ref. Modelo (6 díg.)" : "Código / SKU") +
      "</span></span>" +
      '<span class="sku-action-hint" data-default-label="Copiar">Copiar</span>';
    skuBtn.querySelector(".sku-code-wrap").appendChild(skuValueEl);

    skuBtn.addEventListener("click", function () {
      copySkuToClipboard(currentVariant.codigo, skuBtn);
    });

    if (variants.length > 1) {
      const gradeRow = document.createElement("div");
      gradeRow.className = "size-grade-row";

      const gradeLabel = document.createElement("span");
      gradeLabel.className = "size-grade-label";
      gradeLabel.textContent = "Tamanhos:";
      gradeRow.appendChild(gradeLabel);

      const gradeWrap = document.createElement("div");
      gradeWrap.className = "size-grade-selector";

      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const sBtn = document.createElement("button");
        sBtn.type = "button";
        const isSelected = v.codigo === currentVariant.codigo;
        const isMatched = entry.matchedSet.has(v.codigo);
        sBtn.className =
          "size-grade-btn" +
          (isSelected ? " is-selected" : "") +
          (!isMatched ? " is-dimmed" : "");
        sBtn.textContent = v.tamanho;
        sBtn.title = "Tam " + v.tamanho + " (" + v.codigo + ")";

        sBtn.addEventListener("click", function () {
          currentVariant = v;
          skuValueEl.textContent = v.codigo;
          titleEl.textContent = v.nome;
          refreshPinVisual();
          const allBtns = gradeWrap.children;
          for (let b = 0; b < allBtns.length; b++) {
            allBtns[b].classList.remove("is-selected");
          }
          sBtn.classList.add("is-selected");
        });

        gradeWrap.appendChild(sBtn);
      }

      gradeRow.appendChild(gradeWrap);
      bottomSection.appendChild(gradeRow);
    } else {
      const singleSizeRow = document.createElement("div");
      singleSizeRow.className = "single-size-row";
      singleSizeRow.innerHTML =
        '<span class="size-grade-label">Tamanho:</span>' +
        '<span class="size-pill">' +
        escapeHtml(currentVariant.tamanho) +
        "</span>";
      bottomSection.appendChild(singleSizeRow);
    }

    bottomSection.appendChild(skuBtn);

    article.appendChild(topSection);
    article.appendChild(bottomSection);
    return article;
  }

  function renderInitialBatch() {
    const total = displayEntries.length;
    els.productsGrid.innerHTML = "";
    renderedCount = 0;

    if (total === 0) {
      if (els.homeHub) els.homeHub.hidden = false;
      if (els.pinnedSection) els.pinnedSection.hidden = true;
      if (els.recentSection) els.recentSection.hidden = true;
      els.emptyState.hidden = false;
      els.loadMoreWrap.hidden = true;
      if (els.stateIconSearch) els.stateIconSearch.classList.remove("state-icon-brand");
      if (els.quickSuggestions) els.quickSuggestions.hidden = true;
      els.emptyTitle.textContent = "Nenhum produto encontrado";
      els.emptyDesc.textContent =
        "Tente usar menos palavras, ajustar os filtros ou buscar por parte do modelo ou código.";
      return;
    }

    if (els.homeHub) els.homeHub.hidden = true;
    els.emptyState.hidden = true;
    renderNextBatch();
  }

  function renderNextBatch() {
    if (renderedCount >= displayEntries.length) {
      els.loadMoreWrap.hidden = true;
      return;
    }

    const batchSize = getBatchSize();
    const fragment = document.createDocumentFragment();
    const limit = Math.min(renderedCount + batchSize, displayEntries.length);

    for (let i = renderedCount; i < limit; i++) {
      const card = createProductCard(displayEntries[i], i < 4);
      const batchOffset = i - renderedCount;
      card.style.setProperty("--stagger-delay", Math.min(batchOffset, 10) * 38 + "ms");
      fragment.appendChild(card);
    }

    els.productsGrid.appendChild(fragment);
    renderedCount = limit;

    els.loadMoreWrap.hidden = renderedCount >= displayEntries.length;
  }

  function resetAllFiltersAndSearch() {
    els.searchInput.value = "";
    els.sectorFilter.value = "";
    if (els.publicoFilter) els.publicoFilter.value = "";
    els.categoryFilter.value = "";
    els.brandFilter.value = "";
    els.sizeFilter.value = "";
    els.colorFilter.value = "";
    if (debounceTimer) clearTimeout(debounceTimer);
    executeSearch(true);
  }

  function setupEventListeners() {
    if (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 860px)").matches) {
      els.searchInput.focus();
    }

    // Clicar no logo ou nome BUSCASKU volta para o início do site
    if (els.brandHomeLink) {
      els.brandHomeLink.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (els.qrModal && !els.qrModal.hidden) closeQrModal();
        if (isFiltersDrawerOpen) setFiltersDrawerOpen(false);
        resetAllFiltersAndSearch();
        ignoreScrollUntil = Date.now() + 450;
        if (els.topHeader) els.topHeader.classList.remove("is-scrolled-down");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }

    // Alternar Modo Dark / Light
    if (els.themeToggleBtn) {
      els.themeToggleBtn.addEventListener("click", function () {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        const nextTheme = isDark ? "light" : "dark";
        if (nextTheme === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
        } else {
          document.documentElement.removeAttribute("data-theme");
        }
        if (els.metaThemeColor) {
          els.metaThemeColor.setAttribute("content", nextTheme === "dark" ? "#0f172a" : "#d90429");
        }
        try {
          if (window.localStorage) window.localStorage.setItem(STORAGE_THEME_KEY, nextTheme);
        } catch (_e) {}
      });
    }

    // Alternar Modo Grade ON / OFF
    if (els.toggleGroupModeBtn) {
      els.toggleGroupModeBtn.addEventListener("click", function () {
        isGroupMode = !isGroupMode;
        writeStorageJson(STORAGE_GROUP_MODE_KEY, isGroupMode);
        syncGroupModeButton();
        executeSearch(false);
      });
    }

    if (els.toggleFiltersBtn) {
      els.toggleFiltersBtn.addEventListener("click", function () {
        setFiltersDrawerOpen(!isFiltersDrawerOpen);
      });
    }
    if (els.collapseDrawerUpBtn) {
      els.collapseDrawerUpBtn.addEventListener("click", function () {
        setFiltersDrawerOpen(false);
      });
    }

    if (els.searchForm) {
      els.searchForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (debounceTimer) clearTimeout(debounceTimer);
        recordRecentSearch(els.searchInput.value);
        hideRecentSearchesDropdown();
        executeSearch(false);
        els.searchInput.blur();
        if (isFiltersDrawerOpen) setFiltersDrawerOpen(false);
      });
    }

    els.searchInput.addEventListener("focus", function () {
      originalTypedQuery = els.searchInput.value;
      renderSearchDropdown();
    });

    els.searchInput.addEventListener("blur", function () {
      clearGhostCompletion();
    });

    els.searchInput.addEventListener("scroll", function () {
      if (els.searchInput.scrollLeft > 0) clearGhostCompletion();
    });

    els.searchInput.addEventListener("keydown", function (ev) {
      // Tab ou Seta Direita no fim do texto aceita o autocompletar fantasma estilo Google!
      if (
        (ev.key === "Tab" || (ev.key === "ArrowRight" && els.searchInput.selectionStart === els.searchInput.value.length)) &&
        currentGhostRest
      ) {
        ev.preventDefault();
        els.searchInput.value = els.searchInput.value + currentGhostRest;
        originalTypedQuery = els.searchInput.value;
        renderSearchDropdown();
        if (debounceTimer) clearTimeout(debounceTimer);
        executeSearch(false);
        return;
      }

      if (
        (ev.key === "ArrowDown" || ev.key === "ArrowUp") &&
        els.recentSearchesDropdown &&
        !els.recentSearchesDropdown.hidden &&
        currentDropdownItems.length > 0
      ) {
        ev.preventDefault();
        clearGhostCompletion();
        if (ev.key === "ArrowDown") {
          activeDropdownIdx = activeDropdownIdx + 1 >= currentDropdownItems.length ? -1 : activeDropdownIdx + 1;
        } else {
          activeDropdownIdx = activeDropdownIdx - 1 < -1 ? currentDropdownItems.length - 1 : activeDropdownIdx - 1;
        }
        els.searchInput.value = activeDropdownIdx >= 0 ? currentDropdownItems[activeDropdownIdx] : originalTypedQuery;
        syncDropdownHighlight();
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          executeSearch(false);
        }, 120);
      }
    });

    els.searchInput.addEventListener("input", function () {
      originalTypedQuery = els.searchInput.value;
      renderSearchDropdown();
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        executeSearch(false);
      }, DEBOUNCE_MS);
    });

    if (els.clearRecentSearchesBtn) {
      els.clearRecentSearchesBtn.addEventListener("click", function () {
        recentSearches = [];
        writeStorageJson(STORAGE_RECENT_SEARCHES_KEY, []);
        hideRecentSearchesDropdown();
      });
    }

    document.addEventListener("click", function (ev) {
      if (
        els.recentSearchesDropdown &&
        !els.recentSearchesDropdown.hidden &&
        els.searchForm &&
        !els.searchForm.contains(ev.target)
      ) {
        hideRecentSearchesDropdown();
      }
    });

    els.clearSearchBtn.addEventListener("click", function () {
      els.searchInput.value = "";
      originalTypedQuery = "";
      els.searchInput.focus();
      if (debounceTimer) clearTimeout(debounceTimer);
      executeSearch(false);
      renderSearchDropdown();
    });

    const onDropdownChange = function () {
      ignoreScrollUntil = Date.now() + 300;
      executeSearch(true);
    };

    els.sectorFilter.addEventListener("change", onDropdownChange);
    if (els.publicoFilter) els.publicoFilter.addEventListener("change", onDropdownChange);
    els.categoryFilter.addEventListener("change", onDropdownChange);
    els.brandFilter.addEventListener("change", onDropdownChange);
    els.sizeFilter.addEventListener("change", onDropdownChange);
    els.colorFilter.addEventListener("change", onDropdownChange);

    els.resetFiltersBtn.addEventListener("click", function () {
      resetAllFiltersAndSearch();
      els.searchInput.focus();
    });

    if (els.quickClearAllBtn) {
      els.quickClearAllBtn.addEventListener("click", resetAllFiltersAndSearch);
    }

    if (els.clearRecentBtn) {
      els.clearRecentBtn.addEventListener("click", function () {
        recentSkus = [];
        writeStorageJson(STORAGE_RECENT_KEY, []);
        renderHomeHubLists();
      });
    }

    if (els.quickSuggestions) {
      els.quickSuggestions.addEventListener("click", function (ev) {
        const pill = ev.target && ev.target.closest ? ev.target.closest(".suggestion-pill") : null;
        if (!pill) return;
        const q = pill.getAttribute("data-query") || "";
        els.searchInput.value = q;
        recordRecentSearch(q);
        hideRecentSearchesDropdown();
        executeSearch(false);
      });
    }

    els.loadMoreBtn.addEventListener("click", renderNextBatch);

    // Recolhimento automático ao rolar a tela para baixo (com proteção contra bounce/corte no mobile)
    if (typeof window.addEventListener === "function") {
      let scrollRafId = 0;

      const handleScrollFrame = function () {
        scrollRafId = 0;
        const currentY = Math.max(0, window.scrollY || window.pageYOffset || 0);
        const delta = currentY - lastScrollY;
        const docHeight = document.documentElement.scrollHeight || 0;
        const viewHeight = window.innerHeight || 0;
        const maxScroll = Math.max(0, docHeight - viewHeight);
        const isAtBottomBounce = maxScroll > 0 && currentY >= maxScroll - 24;

        if (els.scrollTopSearchBtn) {
          els.scrollTopSearchBtn.hidden = currentY < 480;
        }

        if (Date.now() > ignoreScrollUntil) {
          const isCollapsed = Boolean(els.topHeader && els.topHeader.classList.contains("is-scrolled-down"));

          // Só recolhe o cabeçalho quando há conteúdo suficiente para rolar sem causar salto/loop
          if (delta > 16 && currentY > 56 && maxScroll > 160) {
            if (isFiltersDrawerOpen) setFiltersDrawerOpen(false);
            if (els.recentSearchesDropdown && !els.recentSearchesDropdown.hidden) hideRecentSearchesDropdown();
            if (els.topHeader && !isCollapsed) {
              els.topHeader.classList.add("is-scrolled-down");
              ignoreScrollUntil = Date.now() + 300;
            }
          } else if (currentY <= 10 || (delta < -32 && !isAtBottomBounce)) {
            if (els.topHeader && isCollapsed) {
              els.topHeader.classList.remove("is-scrolled-down");
              ignoreScrollUntil = Date.now() + 300;
            }
          }
        }

        lastScrollY = currentY;
      };

      window.addEventListener(
        "scroll",
        function () {
          if (!scrollRafId) {
            scrollRafId = window.requestAnimationFrame(handleScrollFrame);
          }
        },
        { passive: true }
      );

      if (els.scrollTopSearchBtn) {
        els.scrollTopSearchBtn.addEventListener("click", function () {
          ignoreScrollUntil = Date.now() + 450;
          window.scrollTo({ top: 0, behavior: "smooth" });
          if (els.topHeader) els.topHeader.classList.remove("is-scrolled-down");
          setTimeout(() => {
            els.searchInput.focus();
            els.searchInput.select();
          }, 260);
        });
      }
    }

    // Modal de QR Code + Foto Ampliada + Compartilhar + Botão Voltar do celular
    els.qrModalClose.addEventListener("click", function () {
      closeQrModal(false);
    });
    els.qrModal.addEventListener("click", function (ev) {
      if (ev.target === els.qrModal) closeQrModal(false);
    });
    if (els.modalTabQr) {
      els.modalTabQr.addEventListener("click", function () {
        setModalViewTab("qr");
      });
    }
    if (els.modalTabPhoto) {
      els.modalTabPhoto.addEventListener("click", function () {
        setModalViewTab("photo");
      });
    }
    els.qrModalSkuBtn.addEventListener("click", function () {
      if (activeQrProduct) copySkuToClipboard(activeQrProduct.codigo, els.qrModalSkuBtn);
    });
    if (els.qrModalPinBtn) {
      els.qrModalPinBtn.addEventListener("click", function () {
        if (!activeQrProduct) return;
        const nowPinned = togglePinSku(activeQrProduct.codigo);
        syncModalPinState();
        if (nowPinned) triggerStarPop(els.qrModalPinBtn);
        showToast(nowPinned ? "Fixado nos Itens de Balcão ★" : "Removido dos Fixados");
      });
    }
    if (els.qrShareBtn) {
      els.qrShareBtn.addEventListener("click", shareActiveQrProduct);
    }
    els.qrDownloadBtn.addEventListener("click", downloadActiveQrPng);

    window.addEventListener("popstate", function () {
      if (els.qrModal && !els.qrModal.hidden) {
        closeQrModal(true);
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && els.qrModal && !els.qrModal.hidden) {
        requestScreenWakeLock();
      } else if (document.visibilityState !== "visible") {
        releaseScreenWakeLock();
      }
    });

    // Zoom no QR Code: scroll do mouse (desktop), pinça com 2 dedos (mobile) e duplo clique/toque
    if (els.qrCanvasBox) {
      let pinchStartDist = 0;
      let pinchStartScale = 1;

      const getTouchDistance = function (touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
      };

      els.qrCanvasBox.addEventListener(
        "wheel",
        function (ev) {
          if (!activeQrProduct) return;
          ev.preventDefault();
          const step = ev.deltaY < 0 ? 0.14 : -0.14;
          setQrZoom(qrZoomScale + step);
        },
        { passive: false }
      );

      els.qrCanvasBox.addEventListener(
        "touchstart",
        function (ev) {
          if (ev.touches.length === 2) {
            ev.preventDefault();
            pinchStartDist = getTouchDistance(ev.touches);
            pinchStartScale = qrZoomScale;
          }
        },
        { passive: false }
      );

      els.qrCanvasBox.addEventListener(
        "touchmove",
        function (ev) {
          if (ev.touches.length === 2 && pinchStartDist > 0) {
            ev.preventDefault();
            const curDist = getTouchDistance(ev.touches);
            setQrZoom(pinchStartScale * (curDist / pinchStartDist));
          }
        },
        { passive: false }
      );

      els.qrCanvasBox.addEventListener("touchend", function (ev) {
        if (ev.touches.length < 2) {
          pinchStartDist = 0;
        }
      });

      els.qrCanvasBox.addEventListener("touchcancel", function () {
        pinchStartDist = 0;
      });

      els.qrCanvasBox.addEventListener("dblclick", function () {
        setQrZoom(qrZoomScale > 1.05 ? 1 : 1.55);
      });
    }

    if (els.qrZoomResetBtn) {
      els.qrZoomResetBtn.addEventListener("click", function () {
        setQrZoom(1);
      });
    }

    if (els.importCsvBtn && els.csvFileInput) {
      els.importCsvBtn.addEventListener("click", function () {
        els.csvFileInput.click();
      });
      els.csvFileInput.addEventListener("change", async function () {
        const files = Array.from(els.csvFileInput.files || []);
        if (files.length === 0) return;
        const texts = await Promise.all(files.map((f) => f.text()));
        unifyRawTextsIntoCatalog(texts);
        executeSearch(true);
        els.csvFileInput.value = "";
      });
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        if (els.recentSearchesDropdown && !els.recentSearchesDropdown.hidden) {
          hideRecentSearchesDropdown();
          return;
        }
        if (els.qrModal && !els.qrModal.hidden) {
          closeQrModal();
          return;
        }
        if (isFiltersDrawerOpen) {
          setFiltersDrawerOpen(false);
          return;
        }
      }
      if (ev.key === "/" && document.activeElement !== els.searchInput && (!els.qrModal || els.qrModal.hidden)) {
        ev.preventDefault();
        els.searchInput.focus();
        els.searchInput.select();
      }
    });

    if ("IntersectionObserver" in window && els.scrollSentinel) {
      scrollObserver = new IntersectionObserver(
        function (entries) {
          if (entries[0] && entries[0].isIntersecting && renderedCount < displayEntries.length) {
            renderNextBatch();
          }
        },
        { rootMargin: "420px" }
      );
      scrollObserver.observe(els.scrollSentinel);
    }
  }

  function warmUpIndexInBackground() {
    let cursor = 0;
    const CHUNK = 500;
    function nextSlice() {
      const end = Math.min(cursor + CHUNK, allProducts.length);
      for (; cursor < end; cursor++) {
        ensureProductIndexed(allProducts[cursor]);
      }
      if (cursor < allProducts.length) {
        setTimeout(nextSlice, 35);
      }
    }
    setTimeout(nextSlice, 250);
  }

  function renderRandomQuickSuggestions() {
    if (!els.quickSuggestions) return;
    const listEl = els.quickSuggestions.querySelector(".quick-suggestions-list");
    if (!listEl) return;

    const lastShown = readStorageJson(STORAGE_LAST_SUGGESTIONS_KEY, []);
    const lastSet = new Set(Array.isArray(lastShown) ? lastShown : []);

    // Prioriza exemplos que não apareceram na atualização anterior
    const freshPool = QUICK_SUGGESTIONS_POOL.filter((q) => !lastSet.has(q));
    const source = freshPool.length >= 4 ? freshPool.slice() : QUICK_SUGGESTIONS_POOL.slice();

    for (let i = source.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = source[i];
      source[i] = source[j];
      source[j] = tmp;
    }

    const chosen = source.slice(0, 4);
    writeStorageJson(STORAGE_LAST_SUGGESTIONS_KEY, chosen);

    listEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < chosen.length; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestion-pill";
      btn.setAttribute("data-query", chosen[i]);
      btn.textContent = chosen[i];
      frag.appendChild(btn);
    }
    listEl.appendChild(frag);
  }

  function setupVoiceSearch() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec || !els.voiceSearchBtn || !els.searchForm) return;

    els.voiceSearchBtn.hidden = false;
    els.searchForm.classList.add("has-voice-btn");

    let recognition = null;
    let isListening = false;

    els.voiceSearchBtn.addEventListener("click", function () {
      if (isListening && recognition) {
        try {
          recognition.stop();
        } catch (_e) {}
        return;
      }

      try {
        recognition = new SpeechRec();
        recognition.lang = "pt-BR";
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = function () {
          isListening = true;
          els.voiceSearchBtn.classList.add("is-listening");
          showToast("Ouvindo... fale o produto, cor ou tamanho");
        };

        recognition.onresult = function (event) {
          let transcript = "";
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          const clean = transcript.trim();
          if (clean) {
            els.searchInput.value = clean;
            originalTypedQuery = clean;
            hideRecentSearchesDropdown();
            if (debounceTimer) clearTimeout(debounceTimer);
            executeSearch(false);
          }
        };

        recognition.onerror = function (ev) {
          if (ev && ev.error === "not-allowed") {
            showToast("Permita o microfone no navegador para usar busca por voz");
          }
        };

        recognition.onend = function () {
          isListening = false;
          els.voiceSearchBtn.classList.remove("is-listening");
          if (els.searchInput.value.trim().length >= 2) {
            recordRecentSearch(els.searchInput.value);
          }
        };

        recognition.start();
      } catch (_err) {
        isListening = false;
        els.voiceSearchBtn.classList.remove("is-listening");
      }
    });
  }

  function setupPwaFeatures() {
    // Indicador de status offline em tempo real
    const syncOnlineStatus = function () {
      if (!els.offlineBadge) return;
      els.offlineBadge.hidden = navigator.onLine !== false;
    };
    syncOnlineStatus();
    window.addEventListener("online", syncOnlineStatus);
    window.addEventListener("offline", function () {
      syncOnlineStatus();
      showToast("Sem internet — operando em modo offline");
    });

    // Botão nativo de instalação do PWA
    window.addEventListener("beforeinstallprompt", function (ev) {
      ev.preventDefault();
      deferredInstallPrompt = ev;
      if (els.installPwaBtn) els.installPwaBtn.hidden = false;
    });

    if (els.installPwaBtn) {
      els.installPwaBtn.addEventListener("click", async function () {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        try {
          await deferredInstallPrompt.userChoice;
        } catch (_e) {}
        deferredInstallPrompt = null;
        els.installPwaBtn.hidden = true;
      });
    }

    window.addEventListener("appinstalled", function () {
      deferredInstallPrompt = null;
      if (els.installPwaBtn) els.installPwaBtn.hidden = true;
      showToast("BuscaSKU instalado na tela inicial!");
    });

    // Registro do Service Worker offline-first
    if ("serviceWorker" in navigator && (window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js").catch(function () {
          // Ignorado caso rodando via file:// ou HTTP na rede local
        });
      });
    }
  }

  async function init() {
    loadUserPreferences();
    renderRandomQuickSuggestions();
    setupEventListeners();
    setupVoiceSearch();
    setupPwaFeatures();
    try {
      await loadInitialCatalog();
      executeSearch(true);
      warmUpIndexInBackground();
    } catch (err) {
      console.error("Erro ao inicializar a base de produtos:", err);
      els.emptyState.hidden = false;
      els.emptyTitle.textContent = "Não foi possível carregar os arquivos de produtos";
      els.emptyDesc.textContent = String(err && err.message ? err.message : err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
