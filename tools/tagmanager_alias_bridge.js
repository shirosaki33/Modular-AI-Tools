/* =========================================================================
   ALIAS BRIDGE MANAGER (Background Processing + Custom Colors)
   ---------------------------------------------------------------------
   Unifica o preview reverso de aliases (Danbooru e e621).
   Danbooru: Azul claro (#4db8ff)
   E621: Rosa (#f48fb1)

   FIX (invalidação do índice): antes, o índice só era reconstruído
   quando o TAMANHO do cache mudava (Object.keys(...).length). Isso
   perdia o caso mais comum — uma tag que JÁ existia no cache ganhar um
   aliasTo depois de resolvida (ex: dbResolveAlias, dbSearchTagMatches) —
   porque o número de chaves não muda, só o conteúdo de uma entrada já
   existente. O preview reverso podia ficar desatualizado por tempo
   indefinido numa sessão.

   Agora comparamos window._danbooruCacheVersion / window._e621CacheVersion
   (contadores incrementados em tagmanager_danbooru_core.js /
   tagmanager_e621_core.js a cada escrita/remoção real no cache) em vez do
   tamanho do objeto. Captura adição, remoção E mutação de valor, com o
   mesmo custo desprezível (comparar dois inteiros).

   ---------------------------------------------------------------------
   FIX (limite/mistura Danbooru x e621 no preview reverso combinado):

   1) BUG: window.computeCombinedReverseAliasesForTag só lia
      window.aliasPreviewMaxCount (o "Max shown" do painel do Danbooru).
      O campo próprio do e621 (window.e621AliasPreviewMaxCount) existe na
      UI (tagmanager_e621_alias.js) mas nunca era realmente consultado
      aqui — mudar aquele número não tinha NENHUM efeito no resultado.
      Agora cada fonte usa o SEU PRÓPRIO limite configurado.

   2) COMPORTAMENTO: antes, a função concatenava TODOS os aliases do
      Danbooru, depois TODOS os do e621, ordenava tudo alfabeticamente e
      só then cortava pelo limite global. Isso significa que o corte
      final podia favorecer quem "ficasse na frente" alfabeticamente —
      numa tag com muitos aliases numa fonte só, a outra fonte podia
      nunca aparecer, mesmo tendo aliases igualmente relevantes pra
      mesma tag.

      Agora o merge é por INTERCALAÇÃO (round-robin): pega 1 alias do
      Danbooru, 1 do e621, 1 do Danbooru, 1 do e621... até cada fonte
      bater no PRÓPRIO limite configurado (ou os aliases dela acabarem).
      Assim as duas fontes aparecem juntas desde o início do preview, em
      vez de uma esperar a outra terminar.

      Também passa a respeitar os toggles individuais (window.showAliasPreview
      / window.e621ShowAliasPreview): se um estiver desligado, os aliases
      daquela fonte simplesmente não entram no cálculo — antes, desligar
      só o do Danbooru (por exemplo) não impedia aliases do Danbooru de
      aparecerem no preview combinado, contanto que o do e621 estivesse
      ligado.
========================================================================= */

window._aliasIndex = {
    danbooru: new Map(),
    e621: new Map(),
    lastDbVersion: -1,
    lastE6Version: -1
};

// Roda de forma totalmente invisível em segundo plano
window._rebuildAliasIndexBackground = function() {
    const dbVersion = window._danbooruCacheVersion || 0;
    const e6Version = window._e621CacheVersion || 0;

    if (dbVersion !== window._aliasIndex.lastDbVersion) {
        const dCache = window.danbooruCache || {};
        const dKeys = Object.keys(dCache);
        const newDbMap = new Map();
        for (let i = 0; i < dKeys.length; i++) {
            const k = dKeys[i];
            const entry = dCache[k];
            if (entry && entry.aliasTo) {
                const target = entry.aliasTo.toLowerCase();
                if (!newDbMap.has(target)) newDbMap.set(target, []);
                newDbMap.get(target).push(k);
            }
        }
        window._aliasIndex.danbooru = newDbMap;
        window._aliasIndex.lastDbVersion = dbVersion;
    }

    if (e6Version !== window._aliasIndex.lastE6Version) {
        const eCache = window.e621Cache || {};
        const eKeys = Object.keys(eCache);
        const newE6Map = new Map();
        for (let i = 0; i < eKeys.length; i++) {
            const k = eKeys[i];
            const entry = eCache[k];
            if (entry && entry.aliasTo) {
                const target = entry.aliasTo.toLowerCase();
                if (!newE6Map.has(target)) newE6Map.set(target, []);
                newE6Map.get(target).push(k);
            }
        }
        window._aliasIndex.e621 = newE6Map;
        window._aliasIndex.lastE6Version = e6Version;
    }
};

// Compila o índice logo após a página abrir, e depois periodicamente.
// Com a checagem virando O(1) (comparar 2 inteiros em vez de medir o
// tamanho do objeto), dá pra rodar num intervalo mais curto sem custo
// extra de CPU — reduz a janela em que o preview pode ficar desatualizado.
setTimeout(window._rebuildAliasIndexBackground, 1000);
setInterval(window._rebuildAliasIndexBackground, 3000);

window.computeCombinedReverseAliasesForTag = function (tagLower) {
    // A interface apenas LÊ o mapa instantâneo. ZERO cálculos durante o scroll.
    const dbEnabled = window.showAliasPreview !== false;
    const e6Enabled = window.e621ShowAliasPreview !== false;

    const danbooruAliases = dbEnabled
        ? (window._aliasIndex.danbooru.get(tagLower) || []).slice().sort((a, b) => a.localeCompare(b))
        : [];
    const e621Aliases = e6Enabled
        ? (window._aliasIndex.e621.get(tagLower) || []).slice().sort((a, b) => a.localeCompare(b))
        : [];

    // Cada fonte usa o SEU PRÓPRIO limite configurado (ver FIX no topo do arquivo).
    const dbMax = window.aliasPreviewMaxCount || 5;
    const e6Max = window.e621AliasPreviewMaxCount || 5;

    // Intercalação (round-robin): 1 de cada fonte por vez, até cada uma bater
    // no próprio limite ou acabarem os aliases dela. Garante que as duas
    // fontes apareçam JUNTAS no preview, em vez de uma esconder a outra.
    const combined = [];
    const seen = new Set();
    let di = 0, ei = 0, dbTaken = 0, e6Taken = 0;

    while ((di < danbooruAliases.length && dbTaken < dbMax) || (ei < e621Aliases.length && e6Taken < e6Max)) {
        if (di < danbooruAliases.length && dbTaken < dbMax) {
            const tag = danbooruAliases[di++];
            const key = tag.toLowerCase();
            if (!seen.has(key)) { seen.add(key); combined.push({ tag, source: 'danbooru' }); dbTaken++; }
        }
        if (ei < e621Aliases.length && e6Taken < e6Max) {
            const tag = e621Aliases[ei++];
            const key = tag.toLowerCase();
            if (!seen.has(key)) { seen.add(key); combined.push({ tag, source: 'e621' }); e6Taken++; }
        }
    }

    // Ordena só pra exibição final (o corte por limite já aconteceu acima,
    // por fonte — isto aqui não descarta nada, só organiza visualmente).
    combined.sort((a, b) => a.tag.localeCompare(b.tag));

    return combined;
};

window.renderCombinedAliasPreviewHTML = function (tagLower) {
    if ((window.showAliasPreview === false) && (window.e621ShowAliasPreview === false)) return '';
    
    const aliases = window.computeCombinedReverseAliasesForTag(tagLower);
    if (aliases.length === 0) return '';

    let html = '<span class="tag-alias-reverse-list" title="Alias tag(s) pointing to this tag: ' + aliases.map(a => a.tag).join(', ') + '">⟵ ';
    
    const aliasSpans = aliases.map(item => {
        const color = item.source === 'e621' ? '#f48fb1' : '#4db8ff';
        return `<span style="color:${color}; pointer-events:none;">${item.tag}</span>`;
    });
    
    html += aliasSpans.join(', ');
    html += '</span>';
    
    return html;
};