// google_translator.js

// 1. A função que o Google chama para montar o botão
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: 'en', // Idioma base da sua interface
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE
    }, 'google_translate_element'); // ID da div onde o botão vai aparecer
}

// 2. Injeta o script externo do Google dinamicamente na página
(function() {
    var gtScript = document.createElement('script');
    gtScript.type = 'text/javascript';
    gtScript.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(gtScript, s);
})();