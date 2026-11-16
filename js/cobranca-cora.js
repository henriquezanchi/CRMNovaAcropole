// Cobranças das escolas pela Cora (16/11/2026, pedido do usuário) — aba Relatórios.
// Prévia dos valores (fixo: membros × R$ 4,96), geração do boleto + Pix na Cora (Edge Function
// cora-cobranca), mensagem pronta para o diretor, acompanhamento do pagamento e lembrete.
// Gerar e cancelar exigem administrador do CRM (confirmação de senha a cada sessão da página).

let credencialAdminCora = null;
let previaCora = null;

async function credencialCora() {
    if (credencialAdminCora) return credencialAdminCora;
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    if (!usuario || !usuario.ehAdmin) { avisar('Só um administrador gera ou cancela cobranças.'); return null; }
    const senha = prompt('Confirme com a sua senha do CRM:');
    if (!senha) return null;
    credencialAdminCora = { usuario: usuario.nome, senha_hash: await calcularHashSenha(senha) };
    return credencialAdminCora;
}

async function chamarCobrancaCora(corpo, comAdmin) {
    const extra = comAdmin ? await credencialCora() : {};
    if (comAdmin && !extra) return null;
    const { data, error } = await window.supabaseClient.functions.invoke('cora-cobranca', { body: { ...corpo, ...extra } });
    if (error || !data || data.ok === false) {
        let msg = data?.erro || error?.message || 'falha';
        try { const j = await error?.context?.json?.(); if (j?.erro) msg = j.erro; } catch (_) { /* sem corpo */ }
        if (/senha|administrador/i.test(msg)) credencialAdminCora = null;
        avisar('Cora: ' + msg);
        return null;
    }
    return data;
}

const reaisCora = (c) => c == null ? '—' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoCora = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const brCora = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

function padroesCora() {
    const hoje = new Date();
    const de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 16), ate = new Date(hoje.getFullYear(), hoje.getMonth(), 15);
    const venc = new Date(hoje.getTime() + 5 * 864e5);
    return { competencia: isoCora(hoje).slice(0, 7), de: isoCora(de), ate: isoCora(ate), vencimento: isoCora(venc) };
}

const STATUS_CORA = {
    criando: ['Gerando', 'am'], OPEN: ['Em aberto', 'am'], LATE: ['Vencida', 'vm'], PAID: ['Paga', ''], CANCELLED: ['Cancelada', 'cz'],
    erro: ['Erro', 'vm'], IN_PAYMENT: ['Em pagamento', 'am'], INITIATED: ['Iniciada', 'am'],
};
function seloCora(st) {
    const [t, c] = STATUS_CORA[st] || [st, 'cz'];
    const cores = { '': 'background:#dcfce7;color:#166534;', am: 'background:#fef3c7;color:#92400e;', vm: 'background:#fee2e2;color:#991b1b;', cz: 'background:#e5e7eb;color:#374151;' };
    return `<span style="padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;${cores[c] || cores.cz}">${escapeHTML(t)}</span>`;
}

async function renderizarCobrancasCora() {
    const box = document.getElementById('relatorioCobrancasCora');
    if (!box) return;
    const p = padroesCora();
    box.innerHTML = `
        <div class="cora-filtros">
            <label>Mês da cobrança<br><input type="month" id="coraCompetencia" value="${p.competencia}"></label>
            <label>Resumo de contatos de<br><input type="date" id="coraDe" value="${p.de}"></label>
            <label>até<br><input type="date" id="coraAte" value="${p.ate}"></label>
            <label>Vencimento<br><input type="date" id="coraVencimento" value="${p.vencimento}"></label>
            <label class="cora-check"><input type="checkbox" id="coraSomentePix" checked> Só Pix (sem boleto)</label>
            <label>Ambiente<br><select id="coraAmbiente"><option value="producao">Produção (cobrança de verdade)</option><option value="stage">Teste (sem cobrar)</option></select></label>
            <button type="button" class="btn-secondary" onclick="carregarPreviaCora()">Ver prévia do fixo</button>
            <button type="button" class="btn-secondary" onclick="atualizarStatusCora()" title="Consulta a Cora agora">Atualizar pagamentos</button>
        </div>
        <div id="coraPrevia"></div>
        <h4 style="margin:22px 0 10px;">Cobranças geradas</h4>
        <div id="coraLista">Carregando…</div>`;
    await listarCobrancasCora();
}

async function carregarPreviaCora() {
    const alvo = document.getElementById('coraPrevia');
    alvo.innerHTML = 'Calculando…';
    const corpo = { acao: 'previa', competencia: document.getElementById('coraCompetencia').value, de: document.getElementById('coraDe').value,
        ate: document.getElementById('coraAte').value, ambiente: document.getElementById('coraAmbiente').value };
    const r = await chamarCobrancaCora(corpo, true);
    if (!r) { alvo.innerHTML = ''; return; }
    previaCora = r.itens || [];
    const linhas = previaCora.map((it, i) => {
        const semCnpj = !it.cnpj;
        const ja = it.ja_gerada && it.ja_gerada.status !== 'CANCELLED';
        const rel = it.relatorio || {};
        return `<tr>
            <td><input type="checkbox" data-cora-i="${i}" ${!semCnpj && !ja && it.valor_centavos >= 500 ? 'checked' : ''} ${semCnpj || ja ? 'disabled' : ''}></td>
            <td>${escapeHTML(it.rotulo)}</td>
            <td style="text-align:right;">${it.override ? 'manual' : (it.membros ?? '—')}</td>
            <td style="text-align:right;"><input type="number" step="0.01" min="5" style="width:100px;text-align:right;" data-cora-valor="${i}" value="${it.valor_centavos != null ? (it.valor_centavos / 100).toFixed(2) : ''}"></td>
            <td style="text-align:right;">${rel.contatados ?? '—'} / ${rel.responderam ?? '—'} / ${rel.inscritos ?? '—'}</td>
            <td>${semCnpj ? '<span style="color:#b91c1c;">Falta CNPJ (Gerenciar Filiais)</span>' : (ja ? 'Já gerada' : 'Pronta')}</td>
        </tr>`;
    }).join('');
    const total = previaCora.reduce((s, it) => s + (it.valor_centavos || 0), 0);
    alvo.innerHTML = `
        <div style="overflow-x:auto;"><table class="tabela-relatorio" style="width:100%;font-size:13px;">
            <thead><tr><th></th><th>Escola</th><th style="text-align:right;">Membros</th><th style="text-align:right;">Valor (R$)</th><th style="text-align:right;">Contatados / responderam / inscritos</th><th>Situação</th></tr></thead>
            <tbody>${linhas}</tbody>
            <tfoot><tr><td></td><td><strong>Total</strong></td><td></td><td style="text-align:right;"><strong>${reaisCora(total)}</strong></td><td></td><td></td></tr></tfoot>
        </table></div>
        <button type="button" class="btn-primary" style="margin-top:10px;" onclick="gerarCobrancasCora()">Gerar boleto + Pix na Cora para as marcadas</button>`;
}

async function gerarCobrancasCora() {
    if (!previaCora) return;
    const itens = [];
    document.querySelectorAll('[data-cora-i]').forEach((cb) => {
        if (!cb.checked) return;
        const i = Number(cb.dataset.coraI);
        const v = parseFloat(String(document.querySelector(`[data-cora-valor="${i}"]`).value).replace(',', '.'));
        itens.push({ filial: previaCora[i].filial, valor_centavos: Math.round(v * 100) });
    });
    if (!itens.length) { avisar('Marque ao menos uma escola.'); return; }
    const amb = document.getElementById('coraAmbiente').value;
    const total = itens.reduce((s, it) => s + it.valor_centavos, 0);
    if (!confirm(`Gerar ${itens.length} cobrança(s) na Cora ${amb === 'stage' ? '(TESTE)' : '(PRODUÇÃO, boleto de verdade)'}, total ${reaisCora(total)}?`)) return;
    const r = await chamarCobrancaCora({ acao: 'gerar', itens, ambiente: amb, somente_pix: document.getElementById('coraSomentePix').checked, competencia: document.getElementById('coraCompetencia').value,
        de: document.getElementById('coraDe').value, ate: document.getElementById('coraAte').value, vencimento: document.getElementById('coraVencimento').value }, true);
    if (!r) return;
    const erros = (r.resultados || []).filter((x) => x.erro);
    avisar(erros.length ? `Geradas com ${erros.length} erro(s): ` + erros.map((e) => `${e.filial}: ${e.erro}`).join('; ') : 'Cobranças geradas na Cora.');
    document.getElementById('coraPrevia').innerHTML = '';
    await listarCobrancasCora();
}

async function listarCobrancasCora() {
    const alvo = document.getElementById('coraLista');
    if (!alvo) return;
    const { data, error } = await window.supabaseClient.from('cobrancas_cora').select('*').order('valor_centavos', { ascending: false }).limit(100);
    if (error) { alvo.textContent = 'Erro: ' + error.message; return; }
    if (!data.length) { alvo.innerHTML = '<p class="report-sub">Nenhuma cobrança gerada ainda.</p>'; return; }
    // Telefones lidos a cada abertura: o que for preenchido em Gerenciar Filiais vale na hora.
    const { data: fs } = await window.supabaseClient.from('filiais').select('nome, whatsapp_chefe_numero, whatsapp_economia');
    // Cobrança vai para o secretário de economia; sem ele, para o chefe da filial.
    const chefe = new Map((fs || []).map((f) => [f.nome, f.whatsapp_economia || f.whatsapp_chefe_numero]));
    const ehEconomia = new Map((fs || []).map((f) => [f.nome, !!f.whatsapp_economia]));
    window.__cobrancasCora = new Map(data.map((c) => [c.id, c]));
    const ativas = data.filter((c) => c.status !== 'CANCELLED');
    const soma = (lista) => lista.reduce((s, c) => s + (c.valor_centavos || 0), 0);
    const pagas = ativas.filter((c) => c.status === 'PAID');
    const resumo = `<div class="cora-resumo">
        <div><span>Total cobrado</span><strong>${reaisCora(soma(ativas))}</strong></div>
        <div><span>Recebido</span><strong class="ok">${reaisCora(soma(pagas))}</strong><small>${pagas.length} de ${ativas.length} escolas</small></div>
        <div><span>Em aberto</span><strong class="pend">${reaisCora(soma(ativas) - soma(pagas))}</strong><small>${ativas.filter((c) => !c.enviada_em && c.status !== 'PAID').length} ainda não enviadas</small></div>
    </div>`;
    const mesCurto = (comp) => { const [a, m] = String(comp).split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1] + '/' + String(a).slice(2); };
    const cartoes = data.map((c) => {
        const tel = String(chefe.get(c.filial) || '').replace(/\D/g, '');
        const pago = c.status === 'PAID', cancelada = c.status === 'CANCELLED';
        const lembrete = !pago && !cancelada && c.lembrete_em;
        const wa = (texto) => `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
        const situacao = pago ? `Paga em ${brCora(c.pago_em)}` : (c.enviada_em ? `Enviada em ${brCora(c.enviada_em)}` : 'Ainda não enviada');
        return `<div class="cora-cartao ${pago ? 'paga' : ''} ${cancelada ? 'cancelada' : ''}">
            <div class="cora-topo">
                <div class="cora-escola">${escapeHTML(String(c.filial).replace(/^Goiânia - /, '').replace(/\/MT$/, ''))}${c.ambiente === 'stage' ? ' <small>(teste)</small>' : ''}</div>
                ${seloCora(c.status)}
            </div>
            <div class="cora-valor">${reaisCora(c.valor_centavos)}</div>
            <div class="cora-info">${mesCurto(c.competencia)} · vence ${brCora(c.vencimento)} · ${situacao}</div>
            ${c.erro ? `<div class="cora-erro">${escapeHTML(c.erro.slice(0, 140))}</div>` : ''}
            ${lembrete ? '<div class="cora-aviso">Sem pagamento há 3 dias: envie o lembrete.</div>' : ''}
            ${!pago && !cancelada ? `<div class="cora-dica">${!tel ? 'Sem WhatsApp de economia nem do chefe (Gerenciar Filiais)' : (ehEconomia.get(c.filial) ? 'Vai para o secretário de economia' : 'Vai para o chefe da filial (sem secretário de economia)')}</div>` : ''}
            ${!cancelada && !pago && c.mensagem ? `<div class="cora-acoes">
                ${lembrete && c.mensagem_lembrete
                    ? `<a class="btn-primary" target="_blank" rel="noopener" href="${wa(c.mensagem_lembrete)}"><i class="fa-brands fa-whatsapp"></i> Enviar lembrete</a>`
                    : `<a class="btn-primary" target="_blank" rel="noopener" href="${wa(c.mensagem)}" onclick="aoAbrirWhatsAppCora(${c.id})"><i class="fa-brands fa-whatsapp"></i> ${c.enviada_em ? 'Reenviar' : 'Enviar'}</a>`}
                <button type="button" class="cora-icone" title="Copiar mensagem" onclick="copiarMensagemCora(${c.id}, '${lembrete ? 'mensagem_lembrete' : 'mensagem'}')"><i class="fa-regular fa-copy"></i></button>
                ${c.boleto_url ? `<a class="cora-icone" title="${c.pix_emv ? 'QR Code do Pix' : 'Boleto'}" target="_blank" rel="noopener" href="${escapeHTML(c.boleto_url)}"><i class="fa-solid ${c.pix_emv ? 'fa-qrcode' : 'fa-barcode'}"></i></a>` : ''}
                ${!c.enviada_em ? `<button type="button" class="cora-icone" title="Marcar como enviada" onclick="marcarEnviadaCora(${c.id})"><i class="fa-solid fa-check"></i></button>` : ''}
                ${c.cora_invoice_id ? `<button type="button" class="cora-icone perigo" title="Cancelar cobrança" onclick="cancelarCobrancaCora(${c.id})"><i class="fa-solid fa-ban"></i></button>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');
    alvo.innerHTML = resumo + `<div class="cora-grade">${cartoes}</div>`;
}

// Abriu o WhatsApp com a mensagem: pergunta (sem bloquear) se pode marcar como enviada.
function aoAbrirWhatsAppCora(id) {
    const c = window.__cobrancasCora && window.__cobrancasCora.get(id);
    if (!c || c.enviada_em) return;
    setTimeout(() => { if (confirm('Mensagem enviada para o diretor? Marcar como enviada (conta os 3 dias do lembrete).')) marcarEnviadaCora(id); }, 1500);
}

function copiarMensagemCora(id, campo) {
    const c = window.__cobrancasCora && window.__cobrancasCora.get(id);
    if (!c || !c[campo]) return;
    navigator.clipboard.writeText(c[campo]).then(() => avisar('Mensagem copiada.'), () => avisar('Não foi possível copiar.'));
}

async function marcarEnviadaCora(id) {
    if (await chamarCobrancaCora({ acao: 'marcar_enviada', id }, true)) listarCobrancasCora();
}

async function cancelarCobrancaCora(id) {
    if (!confirm('Cancelar este boleto na Cora? A escola não conseguirá mais pagar por ele.')) return;
    if (await chamarCobrancaCora({ acao: 'cancelar', id }, true)) listarCobrancasCora();
}

async function atualizarStatusCora() {
    const r = await chamarCobrancaCora({ acao: 'consultar' }, false);
    if (!r) return;
    avisar((r.mudancas || []).filter((m) => m.para).length ? 'Pagamentos atualizados.' : 'Nenhuma mudança na Cora.');
    listarCobrancasCora();
}
