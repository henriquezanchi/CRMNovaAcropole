// Links privados fornecidos pela administração. Não são publicados no banco nem no código do site.
const CHAVE_PAINEIS_SESSAO = 'crm_paineis_filiais_sessao';
function validarEnderecoPainel(valor) {
    const url = new URL(valor);
    if (url.origin !== 'https://crm-nova-acropole-5dv3.vercel.app' || url.pathname !== '/escola.html' || url.username || url.password || url.search || !/^[a-f0-9]{64}$/.test(new URLSearchParams(url.hash.slice(1)).get('chave') || '')) throw new Error('Use o link completo do painel fornecido pela administração.');
    return url.href;
}
function lerPaineisSessao() {
    try { const valor = JSON.parse(sessionStorage.getItem(CHAVE_PAINEIS_SESSAO) || '{}'); return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {}; } catch { return {}; }
}
function abrirPaineisFiliais() {
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    if (!usuario) { alert('Entre no CRM para configurar seus atalhos.'); return; }
    const dialogo = document.getElementById('dialogoPaineisFiliais');
    document.getElementById('painelFilialNome').textContent = filialAtual || 'Selecione a filial no topo do CRM';
    const salvos = lerPaineisSessao();
    document.getElementById('painelFilialEndereco').value = salvos[filialAtual] || '';
    document.getElementById('painelFilialRetorno').textContent = '';
    document.getElementById('painelFilialImportar').value = '';
    dialogo.showModal();
}
async function conferirEnderecoPainel(endereco, escola) {
    const url = validarEnderecoPainel(endereco);
    const resposta = await fetch('https://eovgljcowblwoxmobeno.supabase.co/functions/v1/painel-escola', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:new URLSearchParams(new URL(url).hash.slice(1)).get('chave')})});
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error('Link inválido ou expirado. Solicite um novo à administração.');
    if (dados.escola !== escola) throw new Error('Este link pertence a outra filial. Confira a escola selecionada.');
    return url;
}
async function guardarEnderecoPainel() {
    const retorno = document.getElementById('painelFilialRetorno');
    try {
        const escola = filialAtual;
        if (!escola) throw new Error('Selecione uma filial antes de guardar o link.');
        const url = await conferirEnderecoPainel(document.getElementById('painelFilialEndereco').value.trim(), escola);
        const salvos = lerPaineisSessao(); salvos[escola] = url; sessionStorage.setItem(CHAVE_PAINEIS_SESSAO, JSON.stringify(salvos));
        retorno.textContent = 'Atalho conferido e disponível nesta sessão do navegador.';
    } catch (erro) { retorno.textContent = erro.message; }
}
async function importarEnderecosPaineis() {
    const retorno = document.getElementById('painelFilialRetorno');
    const arquivo = document.getElementById('painelFilialImportar').files[0];
    if (!arquivo) return;
    try {
        if (arquivo.size > 30000) throw new Error('Use somente o arquivo privado de links fornecido pela administração.');
        const itens = JSON.parse(await arquivo.text());
        if (!Array.isArray(itens) || itens.length > 20 || itens.some(item => typeof item.escola !== 'string' || typeof item.url !== 'string')) throw new Error('Arquivo de links inválido.');
        retorno.textContent = 'Conferindo os links das filiais…';
        const conferidos = {};
        for (const item of itens) { if (Object.hasOwn(conferidos, item.escola)) throw new Error('Há filiais repetidas no arquivo.'); conferidos[item.escola] = await conferirEnderecoPainel(item.url, item.escola); }
        sessionStorage.setItem(CHAVE_PAINEIS_SESSAO, JSON.stringify({...lerPaineisSessao(), ...conferidos}));
        document.getElementById('painelFilialEndereco').value = conferidos[filialAtual] || '';
        retorno.textContent = `${itens.length} atalhos conferidos. Escolha a filial no topo e abra este menu para acessar.`;
    } catch (erro) { retorno.textContent = erro.message; }
}
function acessarPainelFilial() {
    const retorno = document.getElementById('painelFilialRetorno');
    try {
        const endereco = lerPaineisSessao()[filialAtual];
        if (!endereco) throw new Error('Guarde o link da filial ou importe o arquivo de links primeiro.');
        window.open(validarEnderecoPainel(endereco), '_blank', 'noopener,noreferrer');
    } catch (erro) { retorno.textContent = erro.message; }
}
async function copiarPainelFilial() {
    const retorno = document.getElementById('painelFilialRetorno');
    try {
        const endereco = lerPaineisSessao()[filialAtual];
        if (!endereco) throw new Error('Guarde o link da filial ou importe o arquivo de links primeiro.');
        await navigator.clipboard.writeText(validarEnderecoPainel(endereco)); retorno.textContent = 'Link copiado. Encaminhe somente aos responsáveis desta filial.';
    } catch { retorno.textContent = 'Confira o link e use o campo acima para copiar manualmente.'; }
}
