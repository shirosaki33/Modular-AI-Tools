/* =========================================================================
   CUSTOM CONFLICTS & SIMILARITY MODULE
   Configure as listas abaixo.
   - tagConflicts: (Vermelho) Coisas impossíveis de coexistirem.
   - tagSimilar: (Amarelo) Tags redundantes, parecidas ou que sobrepõem conceito.

   REGRA GERAL: um mesmo par de tags não deve aparecer simultaneamente em
   tagConflicts e tagSimilar. Se duas tags são mutuamente exclusivas, o
   vermelho já cobre o caso e não deve haver aviso amarelo duplicado/contraditório
   para o mesmo par.

   ATENÇÃO AO MONTAR GRUPOS: o sistema considera TODOS os itens de um mesmo
   array como conflitantes entre si (não só o primeiro item com os demais).
   Ex: ['solo', 'multiple girls', 'multiple boys'] faria 'multiple girls'
   conflitar com 'multiple boys' também, o que é errado. Por isso, sempre que
   um "hub" (ex: solo / no humans) precisar se relacionar com dois subgrupos
   que NÃO devem conflitar entre si (ex: contagens de meninas vs meninos),
   use grupos separados — um por combinação — em vez de um array só.
========================================================================= */

// ---------------------------------------------------------------------
// CONSTANTES REUTILIZÁVEIS (evita duplicar as mesmas listas em vários lugares)
// ---------------------------------------------------------------------

// Contagens EXATAS — mutuamente exclusivas entre si (não dá pra ser 1girl e 3girls ao mesmo tempo)
const GIRLS_COUNT_EXACT = ['1girl', '2girls', '3girls', '4girls', '5girls', '6+girls'];
const BOYS_COUNT_EXACT  = ['1boy', '2boys', '3boys', '4boys', '5boys', '6+boys'];

// Contagens > 1 (usadas na regra do "solo", que exclui apenas 1girl/1boy)
const GIRLS_COUNT_MULTI = GIRLS_COUNT_EXACT.slice(1);
const BOYS_COUNT_MULTI  = BOYS_COUNT_EXACT.slice(1);

// Posturas "base" claramente distintas entre si (crouching/squatting são tratadas à parte, ver abaixo)
const POSES_BASE = ['standing', 'sitting', 'lying', 'kneeling', 'all fours'];


// 🚨 VERMELHO: CONFLITOS REAIS (Mutuamente Exclusivos)
window.tagConflicts = [
    // CONTAGEM EXATA DE PERSONAGENS (mutuamente exclusiva entre si)
    GIRLS_COUNT_EXACT,
    BOYS_COUNT_EXACT,

    // 'multiple girls'/'multiple boys' são tags "guarda-chuva" (2+) que Danbooru aplica
    // JUNTO das contagens exatas de 2 pra cima (ex: 3girls quase sempre também leva
    // multiple girls — não são mutuamente exclusivas). Por isso só conflitam com a
    // contagem de 1 (não dá pra ser "1girl" e também "multiple girls").
    ['1girl', 'multiple girls'],
    ['1boy', 'multiple boys'],

    // REGRA DO "SOLO" (solo não pode coexistir com contagens > 1).
    // Meninas e meninos ficam em grupos SEPARADOS de propósito: se estivessem juntos
    // num array só, '2girls' acabaria conflitando com '2boys' (o que é errado — uma
    // cena pode ter 2 meninas E 2 meninos ao mesmo tempo).
    ['solo', ...GIRLS_COUNT_MULTI],
    ['solo', 'multiple girls'],
    ['solo', ...BOYS_COUNT_MULTI],
    ['solo', 'multiple boys'],

    // REGRA DO "NO HUMANS" — mesmo cuidado acima: 'multiple girls'/'multiple boys' ficam
    // em pares próprios para não conflitar entre si nem com as contagens exatas.
    ['no humans', 'solo'],
    ['no humans', ...GIRLS_COUNT_EXACT],
    ['no humans', 'multiple girls'],
    ['no humans', ...BOYS_COUNT_EXACT],
    ['no humans', 'multiple boys'],

    // CLIMA E AMBIENTE BÁSICO
    ['day', 'night'],
    ['indoor', 'outdoor'],
    ['sunlight', 'moonlight'],

    // CORES E ESTILO
    ['monochrome', 'colorful'],

    // FISIOLOGIA BÁSICA
    ['open eyes', 'eyes closed'],
    ['censored', 'uncensored'],

    // POSES (mutuamente exclusivas - postura básica do corpo)
    // 'crouching' e 'squatting' descrevem posturas quase idênticas (agachado, peso nos pés,
    // joelhos dobrados) — por isso cada uma conflita com as posturas base, mas NÃO uma com
    // a outra (essa relação vira só aviso de similaridade/amarelo, mais abaixo).
    [...POSES_BASE, 'crouching'],
    [...POSES_BASE, 'squatting'],
    ['on back', 'on stomach', 'on side'],

    // DIREÇÃO DO OLHAR (básico, mutuamente exclusivo)
    // Nota: 'looking back' NÃO entra aqui — descreve a orientação do corpo/cabeça
    // (virado de costas, olhando por cima do ombro), não a direção do olhar em si.
    // É perfeitamente válido combinar 'looking back' + 'looking at viewer' (a pose
    // clássica de "olhando por cima do ombro para o espectador") ou 'looking back' + 'looking away'.
    ['looking at viewer', 'looking away'],

    // EXPRESSÕES MUTUAMENTE EXCLUSIVAS
    // Nota: 'crying' NÃO entra aqui — é um estado/ação que pode coexistir com várias
    // expressões (chorar de raiva, de susto, de emoção/felicidade, etc.). A relação dela
    // com 'sad' fica só como aviso de similaridade (amarelo) mais abaixo.
    ['happy', 'sad', 'angry', 'expressionless', 'scared', 'surprised', 'shocked', 'bored', 'disgusted']
];


// 🟨 AMARELO: TAGS SIMILARES OU REDUNDANTES (Avisos de Sobreposição)
window.tagSimilar = [
    // EXPRESSÕES (Sinônimos - cada grupo aqui NÃO repete pares já cobertos no vermelho)
    ['happy', 'smile', 'smiling', 'grin', 'laughing'],
    ['sad', 'crying', 'tears', 'frowning'],
    ['angry', 'annoyed', 'scowl', 'glaring'],
    ['expressionless', 'blank stare', 'emotionless'],
    ['shocked', 'wide-eyed'],          // 'surprised' removido: já conflita com 'shocked' no vermelho
    ['closed mouth', 'parted lips', 'open mouth'],

    // POSTURA (quase-sinônimos — ver nota no grupo de poses do vermelho)
    ['crouching', 'squatting'],

    // CABELO E CORES
    ['short hair', 'medium hair', 'long hair', 'very long hair', 'absurdly long hair'],
    ['blonde hair', 'red hair', 'brown hair', 'black hair', 'blue hair', 'purple hair', 'pink hair', 'green hair', 'white hair', 'silver hair', 'grey hair'],
    // Obs: tags de cabelo multicolorido (gradient hair, two-tone hair, streaked hair, etc.)
    // não entram neste grupo de propósito, pois são combinações legítimas com as cores acima.

    // ANATOMIA E SEIOS
    ['flat chest', 'small breasts', 'medium breasts', 'large breasts', 'huge breasts', 'gigantic breasts'],

    // ESTADO DE ROUPA
    ['nude', 'completely nude', 'topless', 'bottomless', 'naked'],

    // ENQUADRAMENTO DA CÂMERA
    ['portrait', 'close-up', 'cowboy shot', 'upper body', 'full body'],
    ['from above', 'from below', 'from behind', 'from side'],
    ['dutch angle', 'tilted frame']
];