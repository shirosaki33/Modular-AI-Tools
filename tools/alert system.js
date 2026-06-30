// ==========================================
// ALERTA FIXO (Nomes Locais / Civitai)
// ==========================================

function showLocalNameAlert() {
    // Procura se a caixa de alerta já existe no HTML
    let alertBox = document.getElementById('civitai-dynamic-alert');
    
    // Se a caixa ainda não existir, o código cria ela do zero
    if (!alertBox) {
        alertBox = document.createElement('div');
        alertBox.id = 'civitai-dynamic-alert';
        
        // Aplica todo o estilo visual (fundo escuro, bordas amarelas nas laterais, etc)
        alertBox.style.cssText = 'margin: 0; padding: 10px 14px; border-left: 3px solid #ffd040; border-right: 3px solid #ffd040; background: #101723; color: #f5f5f5; border-radius: 7px; font-size: 13.5px; line-height: 1.45; text-align: center; display: block; width: 100%; box-sizing: border-box; clear: both;';
        
        // Procura os locais onde a caixa deve ser encaixada na página
        const panelLeft = document.querySelector('.panel-left');
        const loraList = document.getElementById('loraList');
        
        // Decide onde injetar a caixa dependendo de qual parte da página carregou
        if (panelLeft) {
            panelLeft.parentNode.insertBefore(alertBox, panelLeft.nextSibling);
        } else if (loraList) {
            loraList.parentNode.insertBefore(alertBox, loraList.nextSibling);
        }
    }
    
    // Mostra a caixa na tela e insere o texto com os emojis de aviso
    alertBox.style.display = 'block';
    alertBox.innerHTML = '<span style="color:#ffd040;margin:0 6px;font-size:14px;line-height:1;">⚠️</span> Model names in white are local filenames from the metadata and may not match official titles. Click the ↗ icon to search on Civitai <span style="color:#ffd040;margin:0 6px;font-size:14px;line-height:1;">⚠️</span>';
}

// Função para esconder o alerta quando necessário
function hideLocalNameAlert() {
    const alertBox = document.getElementById('civitai-dynamic-alert');
    // Se a caixa existir, ele muda o display para 'none' (esconde)
    if (alertBox) alertBox.style.display = 'none';
}