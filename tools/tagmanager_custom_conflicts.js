/* =========================================================================
   CUSTOM CONFLICTS & SIMILARITY MODULE
   Configure as listas abaixo.
   - tagConflicts: (Vermelho) Coisas impossíveis de coexistirem.
   - tagSimilar: (Amarelo) Tags redundantes, parecidas ou que sobrepõem conceito.

   REGRA GERAL: um mesmo par de tags não deve aparecer simultaneamente em
   tagConflicts e tagSimilar. Se duas tags são mutuamente exclusivas, o
   vermelho já cobre o caso e não deve haver aviso amarelo duplicado/contraditório
   para o mesmo par.
========================================================================= */

// ---------------------------------------------------------------------
// CONSTANTES REUTILIZÁVEIS (evita duplicar as mesmas listas em vários lugares)
// ---------------------------------------------------------------------
const GIRLS_COUNT = ['1girl', '2girls', '3girls', '4girls', '5girls', '6+girls', 'multiple girls'];
const BOYS_COUNT  = ['1boy', '2boys', '3boys', '4boys', '5boys', '6+boys', 'multiple boys'];

// Contagens > 1 (usadas na regra do "solo", que exclui apenas 1girl/1boy)
const GIRLS_COUNT_MULTI = GIRLS_COUNT.slice(1);
const BOYS_COUNT_MULTI  = BOYS_COUNT.slice(1);


// 🚨 VERMELHO: CONFLITOS REAIS (Mutuamente Exclusivos)
window.tagConflicts = [
    // CONTAGEM DE PERSONAGENS
    GIRLS_COUNT,
    BOYS_COUNT,

    // REGRA DO "SOLO" (solo não pode coexistir com contagens > 1)
    ['solo', ...GIRLS_COUNT_MULTI, ...BOYS_COUNT_MULTI],

    // REGRA DO "NO HUMANS" (Separados para não causar falso conflito entre solo e 1girl)
    ['no humans', 'solo'],
    ['no humans', ...GIRLS_COUNT],
    ['no humans', ...BOYS_COUNT],

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
    ['standing', 'sitting', 'lying', 'kneeling', 'crouching', 'squatting', 'all fours'],
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