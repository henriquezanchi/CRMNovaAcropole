// WhatsApp oficial de cada escola no CRM (26/11/2026, pedido do usuário).
//
// Em Gerenciar Filiais, cada escola tem o bloco "WhatsApp oficial da escola". "Conectar" abre o cadastro
// incorporado da Meta (Embedded Signup v5) com coexistência: o número continua funcionando no app WhatsApp Business
// do celular e passa a funcionar também no CRM. A troca do código pelo token e todo o resto ficam na Edge Function
// whatsapp-conexao (o segredo do app nunca chega ao navegador).
//
// Depois de conectar, as conversas do número da escola já entram no CRM, mas nada sai por ele até ligar
// "Usar no CRM" (inclusive os robôs). Mexer na conexão exige administrador e a senha do CRM.

const SDK_FACEBOOK = 'https://connect.facebook.net/pt_BR/sdk.js';
// Versão do diálogo de login. O cadastro v5 (coexistência ligada por padrão, out/2026) pede a versão mais recente;
// com v21.0 a Meta abria o fluxo antigo, sem a opção de conectar o app WhatsApp Business (27/11/2026).
const VERSAO_SDK_FACEBOOK = 'v27.0';
let configWhatsappOficial = null;
let sdkFacebookPronto = null;

async function chamarWhatsappConexao(corpo) {
    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-conexao', { body: corpo });
    if (error) {
        // Erro HTTP da função: a mensagem útil vem no corpo.
        let detalhe = error.message;
        try { const j = await error.context?.json(); if (j?.erro) detalhe = j.erro; } catch (_) { /* sem corpo */ }
        return { ok: false, erro: detalhe };
    }
    return data || { ok: false, erro: 'Sem resposta do servidor.' };
}

/** Pede a senha do administrador logado (a função confere de novo no servidor). */
async function credenciaisAdminWhatsapp(acao) {
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    if (!usuario || !usuario.ehAdmin) { avisar('Só um administrador mexe na conexão do WhatsApp.'); return null; }
    const senha = prompt(`${acao}\n\nConfirme com a sua senha do CRM:`);
    if (!senha) return null;
    return { usuario: usuario.nome, senhaHash: await calcularHashSenha(senha) };
}

function carregarSdkFacebook(appId, versao) {
    if (sdkFacebookPronto) return sdkFacebookPronto;
    sdkFacebookPronto = new Promise((resolve, reject) => {
        window.fbAsyncInit = function () {
            window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: versao });
            resolve(window.FB);
        };
        const script = document.createElement('script');
        script.src = SDK_FACEBOOK;
        script.async = true;
        script.defer = true;
        script.crossOrigin = 'anonymous';
        script.onerror = () => { sdkFacebookPronto = null; reject(new Error('Não foi possível carregar o login da Meta. Verifique bloqueadores de anúncio.')); };
        document.body.appendChild(script);
    });
    return sdkFacebookPronto;
}

/**
 * Abre o cadastro da Meta e devolve { code, sessao } quando a pessoa termina. A sessão (número, conta) chega por
 * postMessage; o código, pelo retorno do FB.login. Os dois podem chegar em qualquer ordem.
 */
function abrirCadastroMeta(configId) {
    return new Promise((resolve, reject) => {
        let sessao = null;
        let code = null;
        let encerrado = false;
        const terminar = (fn, valor) => {
            if (encerrado) return;
            encerrado = true;
            window.removeEventListener('message', ouvir);
            fn(valor);
        };
        const talvezResolver = () => { if (code && sessao) terminar(resolve, { code, sessao }); };
        function ouvir(evento) {
            if (!/(^|\.)facebook\.com$/.test(new URL(evento.origin).hostname)) return;
            let dados;
            try { dados = typeof evento.data === 'string' ? JSON.parse(evento.data) : evento.data; } catch (_) { return; }
            if (!dados || dados.type !== 'WA_EMBEDDED_SIGNUP') return;
            if (dados.event === 'CANCEL') {
                const etapa = dados.data?.current_step ? ` (parou em: ${dados.data.current_step})` : '';
                return terminar(reject, new Error('O cadastro foi fechado antes de terminar' + etapa + '.'));
            }
            if (dados.event === 'ERROR') {
                return terminar(reject, new Error('A Meta informou um erro: ' + (dados.data?.error_message || 'sem detalhe')));
            }
            if (String(dados.event || '').startsWith('FINISH')) {
                sessao = { ...(dados.data || {}), evento: dados.event };
                talvezResolver();
            }
        }
        window.addEventListener('message', ouvir);
        window.FB.login((resposta) => {
            code = resposta?.authResponse?.code || null;
            if (!code) return terminar(reject, new Error('O cadastro foi fechado antes de terminar.'));
            // Se a sessão não chegar em 10 s, segue só com o código: o servidor descobre a conta pelo token.
            if (!sessao) setTimeout(() => { if (!encerrado) terminar(resolve, { code, sessao: null }); }, 10000);
            talvezResolver();
        }, {
            config_id: configId,
            response_type: 'code',
            override_default_response_type: true,
            extras: {
                setup: {},
                version: 'v5',
                featureType: 'whatsapp_business_app_onboarding',
                sessionInfoVersion: '3',
            },
        });
    });
}

async function conectarWhatsappOficial(nomeFilial) {
    if (!configWhatsappOficial) configWhatsappOficial = await chamarWhatsappConexao({ acao: 'config' });
    const cfg = configWhatsappOficial;
    if (!cfg?.ok || !cfg.appId) { configWhatsappOficial = null; avisar('O app da Meta não está configurado no servidor.'); return; }
    if (!cfg.configId) { configWhatsappOficial = null; avisar('Falta a configuração do cadastro da Meta (WHATSAPP_ES_CONFIG_ID) no servidor.'); return; }
    const confirmou = confirm(
        `Conectar o WhatsApp oficial de ${nomeFilial} ao CRM.\n\n` +
        '1. Tenha em mãos o celular com o app WhatsApp Business da escola (versão atualizada).\n' +
        '2. Na janela da Meta, escolha a empresa da própria escola e a opção de conectar o app WhatsApp Business existente.\n' +
        '3. Leia o QR code com o celular quando pedir.\n\n' +
        'O WhatsApp Web e o desktop da escola serão desconectados e precisarão ser conectados de novo no celular. ' +
        'Grupos não aparecem no CRM. Abra o app no celular pelo menos a cada 14 dias.\n\nContinuar?');
    if (!confirmou) return;
    const cred = await credenciaisAdminWhatsapp(`Conectar o WhatsApp de ${nomeFilial}`);
    if (!cred) return;
    try {
        await carregarSdkFacebook(cfg.appId, VERSAO_SDK_FACEBOOK);
        const { code, sessao } = await abrirCadastroMeta(cfg.configId);
        avisar('Conectando o número ao CRM...');
        const r = await chamarWhatsappConexao({
            acao: 'conectar', filial: nomeFilial, ...cred, code,
            phoneNumberId: sessao?.phone_number_id || null,
            wabaId: sessao?.waba_id || sessao?.messaging_account_ids?.[0] || null,
            businessId: sessao?.business_id || null,
            coexistencia: sessao?.evento === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' || sessao?.is_on_biz_app === true,
        });
        if (!r.ok) { avisar('Não foi possível conectar: ' + r.erro); return; }
        const aviso = r.errosSincronizacao?.length ? `\n\nAtenção, a importação do histórico não começou: ${r.errosSincronizacao.join(' · ')}` : '';
        avisar(`WhatsApp ${r.numero || ''} (${r.nome || nomeFilial}) conectado. As conversas já entram no CRM; para enviar por este número, ligue "Usar no CRM".${aviso}`);
    } catch (e) {
        avisar(e.message || String(e));
    }
    carregarStatusWhatsappOficial();
}

async function alternarUsoWhatsappOficial(nomeFilial, ligar) {
    const texto = ligar
        ? `Usar o WhatsApp de ${nomeFilial} nos envios do CRM?\n\nAs respostas, os modelos e os robôs (campanhas, reengajamento) passam a sair por este número. Os modelos de mensagem precisam estar aprovados na conta do WhatsApp da própria escola.`
        : `Parar de enviar pelo WhatsApp de ${nomeFilial}? As conversas continuam entrando no CRM.`;
    if (!confirm(texto)) { carregarStatusWhatsappOficial(); return; }
    const cred = await credenciaisAdminWhatsapp(ligar ? 'Ligar o uso no CRM' : 'Desligar o uso no CRM');
    if (!cred) { carregarStatusWhatsappOficial(); return; }
    const r = await chamarWhatsappConexao({ acao: 'usar_no_crm', filial: nomeFilial, ligar, ...cred });
    if (!r.ok) avisar('Não foi possível salvar: ' + r.erro);
    carregarStatusWhatsappOficial();
}

async function registrarWhatsappOficial(nomeFilial) {
    const cred = await credenciaisAdminWhatsapp(`Registrar na API o número de ${nomeFilial}`);
    if (!cred) return;
    const r = await chamarWhatsappConexao({ acao: 'registrar', filial: nomeFilial, ...cred });
    avisar(r.ok ? `Número registrado (status ${r.status || 'CONNECTED'}).` : 'Não foi possível registrar: ' + (r.erro || '?'));
    carregarStatusWhatsappOficial();
}

async function sincronizarWhatsappOficial(nomeFilial) {
    const cred = await credenciaisAdminWhatsapp(`Pedir de novo os contatos e o histórico de ${nomeFilial}`);
    if (!cred) return;
    const r = await chamarWhatsappConexao({ acao: 'sincronizar', filial: nomeFilial, ...cred });
    avisar(r.ok ? 'Pedido enviado. O histórico chega aos poucos.' : 'A Meta recusou: ' + (r.erros || [r.erro]).join(' · '));
    carregarStatusWhatsappOficial();
}

async function desconectarWhatsappOficial(nomeFilial) {
    if (!confirm(`Desconectar o WhatsApp de ${nomeFilial} do CRM?\n\nO número continua normal no celular. As conversas já importadas ficam no CRM.`)) return;
    const cred = await credenciaisAdminWhatsapp(`Desconectar o WhatsApp de ${nomeFilial}`);
    if (!cred) return;
    const r = await chamarWhatsappConexao({ acao: 'desconectar', filial: nomeFilial, ...cred });
    avisar(r.ok ? 'Desconectado do CRM. Para tirar o número da plataforma de vez, use no app: Configurações > Conta > Plataforma Business > Desconectar.' : 'Não foi possível desconectar: ' + r.erro);
    carregarStatusWhatsappOficial();
}

function dataCurtaWhatsappOficial(iso) {
    return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}

/** HTML do bloco de uma filial, a partir da linha da view (ou null, se nunca conectou). */
function htmlWhatsappOficial(nomeFilial, c) {
    const nomeJs = escapeHTML(JSON.stringify(nomeFilial));
    if (!c || c.estado === 'desconectado') {
        const antes = c ? `<div class="wpp-oficial-aviso">Desconectado em ${dataCurtaWhatsappOficial(c.desconectado_em)}${c.ultimo_erro ? ' · ' + escapeHTML(c.ultimo_erro) : ''}.</div>` : '';
        return `${antes}<button type="button" class="btn-primary" onclick="conectarWhatsappOficial(${nomeJs})"><i class="fa-brands fa-whatsapp"></i> ${c ? 'Conectar de novo' : 'Conectar WhatsApp da escola'}</button>`;
    }
    const historico = c.historico_sincronizacao_em
        ? (c.historico_progresso != null ? `Histórico: ${c.historico_progresso}% importado` : 'Histórico pedido, aguardando a Meta')
        : (c.coexistencia ? 'Histórico ainda não pedido' : '');
    return `
        <div class="wpp-oficial-linha">
            <span class="filial-chip ${c.estado === 'conectado' ? 'filial-chip-ok' : 'filial-chip-alerta'}">${c.estado === 'conectado' ? 'Conectado' : 'Com erro'}</span>
            <strong>${escapeHTML(c.numero_exibicao || '')}</strong> ${c.nome_verificado ? '· ' + escapeHTML(c.nome_verificado) : ''}
            ${c.coexistencia ? '<span class="filial-chip">Também no app do celular</span>' : ''}
            ${c.extra_campanhas ? '<span class="filial-chip filial-chip-ok" title="Soma capacidade às campanhas de todas as escolas, com limite próprio na Meta">Número extra das campanhas (todas as escolas)</span>' : ''}
        </div>
        <div class="wpp-oficial-detalhe">Conectado em ${dataCurtaWhatsappOficial(c.conectado_em)}${c.conectado_por ? ' por ' + escapeHTML(c.conectado_por) : ''}${historico ? ' · ' + historico : ''}</div>
        ${c.ultimo_erro ? `<div class="wpp-oficial-aviso">${escapeHTML(c.ultimo_erro)}</div>` : ''}
        <label class="filial-opcao" title="Desligado: as conversas deste número entram no CRM, mas nada sai por ele.">
            <input type="checkbox" ${c.usar_no_crm ? 'checked' : ''} onchange="alternarUsoWhatsappOficial(${nomeJs}, this.checked)"> ${c.extra_campanhas ? 'Usar no CRM (convites das campanhas também saem por este número; ligue depois dos modelos aprovados)' : 'Usar no CRM (respostas, modelos e robôs saem por este número)'}
        </label>
        <div class="wpp-oficial-acoes">
            ${c.coexistencia ? `<button type="button" class="btn-secondary" onclick="sincronizarWhatsappOficial(${nomeJs})">Pedir histórico de novo</button>` : ''}
            ${!c.coexistencia ? `<button type="button" class="btn-secondary" onclick="registrarWhatsappOficial(${nomeJs})" title="Número de API (sem app no celular) pendente na Meta: conclui o registro">Registrar na API</button>` : ''}
            <button type="button" class="btn-secondary" onclick="conectarWhatsappOficial(${nomeJs})">Reconectar</button>
            <button type="button" class="btn-secondary wpp-oficial-perigo" onclick="desconectarWhatsappOficial(${nomeJs})">Desconectar do CRM</button>
        </div>`;
}

async function carregarStatusWhatsappOficial() {
    const blocos = document.querySelectorAll('.wpp-oficial[data-filial]');
    if (!blocos.length) return;
    const { data, error } = await window.supabaseClient.from('whatsapp_conexoes_status').select('*');
    const por = new Map((data || []).map(c => [c.filial, c]));
    blocos.forEach(bloco => {
        bloco.innerHTML = error
            ? `<span class="filial-campo-ajuda">Ainda indisponível (${escapeHTML(error.message)}).</span>`
            : htmlWhatsappOficial(bloco.dataset.filial, por.get(bloco.dataset.filial) || null);
    });
}
