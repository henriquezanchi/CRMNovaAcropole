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
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px;">
            <label style="font-size:12px;">Mês da cobrança<br><input type="month" id="coraCompetencia" value="${p.competencia}"></label>
            <label style="font-size:12px;">Resumo de contatos de<br><input type="date" id="coraDe" value="${p.de}"></label>
            <label style="font-size:12px;">até<br><input type="date" id="coraAte" value="${p.ate}"></label>
            <label style="font-size:12px;">Vencimento<br><input type="date" id="coraVencimento" value="${p.vencimento}"></label>
            <label style="font-size:12px;">Ambiente<br><select id="coraAmbiente"><option value="producao">Produção (boleto de verdade)</option><option value="stage">Teste (Cora Stage)</option></select></label>
            <button type="button" class="btn-secondary" onclick="carregarPreviaCora()">Ver prévia do fixo</button>
            <button type="button" class="btn-secondary" onclick="atualizarStatusCora()" title="Consulta a Cora agora">Atualizar pagamentos</button>
        </div>
        <div id="coraPrevia"></div>
        <h4 style="margin:18px 0 8px;">Cobranças geradas</h4>
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
    const r = await chamarCobrancaCora({ acao: 'gerar', itens, ambiente: amb, competencia: document.getElementById('coraCompetencia').value,
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
    const { data, error } = await window.supabaseClient.from('cobrancas_cora').select('*').order('criado_em', { ascending: false }).limit(100);
    if (error) { alvo.textContent = 'Erro: ' + error.message; return; }
    if (!data.length) { alvo.innerHTML = '<p class="report-sub">Nenhuma cobrança gerada ainda.</p>'; return; }
    const { data: fs } = await window.supabaseClient.from('filiais').select('nome, whatsapp_chefe_numero');
    const chefe = new Map((fs || []).map((f) => [f.nome, f.whatsapp_chefe_numero]));
    window.__cobrancasCora = new Map(data.map((c) => [c.id, c]));
    alvo.innerHTML = `<div style="overflow-x:auto;"><table class="tabela-relatorio" style="width:100%;font-size:13px;">
        <thead><tr><th>Escola</th><th>Mês</th><th style="text-align:right;">Valor</th><th>Vencimento</th><th>Situação</th><th>Enviada</th><th>Ações</th></tr></thead>
        <tbody>${data.map((c) => {
            const tel = String(chefe.get(c.filial) || '').replace(/\D/g, '');
            const pago = c.status === 'PAID';
            const lembrete = !pago && c.status !== 'CANCELLED' && c.lembrete_em;
            return `<tr>
                <td>${escapeHTML(String(c.filial).replace(/^Goiânia - /, ''))}${c.ambiente === 'stage' ? ' <small style="color:#92400e;">(teste)</small>' : ''}</td>
                <td>${escapeHTML(c.competencia)}</td>
                <td style="text-align:right;">${reaisCora(c.valor_centavos)}</td>
                <td>${brCora(c.vencimento)}</td>
                <td>${seloCora(c.status)}${pago && c.pago_em ? `<br><small>${brCora(c.pago_em)}</small>` : ''}${c.erro ? `<br><small style="color:#b91c1c;">${escapeHTML(c.erro.slice(0, 120))}</small>` : ''}${lembrete ? '<br><small style="color:#92400e;">Lembrete pendente</small>' : ''}</td>
                <td>${c.enviada_em ? brCora(c.enviada_em) : '—'}</td>
                <td style="white-space:nowrap;">
                    ${c.mensagem ? `<button type="button" class="btn-secondary" onclick="copiarMensagemCora(${c.id}, 'mensagem')">Copiar mensagem</button>
                    <a class="btn-secondary" target="_blank" rel="noopener" href="https://wa.me/${tel}?text=${encodeURIComponent(c.mensagem)}">WhatsApp${tel ? '' : ' (escolher contato)'}</a>` : ''}
                    ${c.mensagem && !c.enviada_em && !pago ? `<button type="button" class="btn-secondary" onclick="marcarEnviadaCora(${c.id})">Marcar enviada</button>` : ''}
                    ${lembrete && c.mensagem_lembrete ? `<a class="btn-secondary" target="_blank" rel="noopener" href="https://wa.me/${tel}?text=${encodeURIComponent(c.mensagem_lembrete)}">Lembrete</a>` : ''}
                    ${c.boleto_url ? `<a class="btn-secondary" target="_blank" rel="noopener" href="${escapeHTML(c.boleto_url)}">Boleto</a>` : ''}
                    ${!pago && c.cora_invoice_id && c.status !== 'CANCELLED' ? `<button type="button" class="btn-secondary" onclick="cancelarCobrancaCora(${c.id})">Cancelar</button>` : ''}
                </td></tr>`;
        }).join('')}</tbody></table></div>`;
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
