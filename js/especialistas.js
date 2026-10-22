// Filas por especialidade: leitura paginada, sem envio ou atribuição automática de pessoas.
let especialistasConsulta = 0;
let especialistasApos = null;
const nomesEspecialistas = {qualificacao:'Qualificação',informacoes:'Informações iniciais',eventos:'Eventos e inscrições',pos_evento:'Pós-evento',matricula:'Matrícula',antigos_alunos:'Antigos alunos',acolhimento:'Atendimento de aluno',interno:'Conferência interna'};
async function carregarEspecialistas(mais = false) {
    const numero = ++especialistasConsulta, filial = filialAtual;
    const lista = document.getElementById('especialistasLista'), status = document.getElementById('especialistasStatus');
    if (!filial || !lista) return;
    if (!mais) especialistasApos = null;
    status.textContent = 'Consultando qualificações e pendências…';
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    const meus = document.getElementById('especialistasMeus').checked;
    if (meus && !usuario?.nome) {status.textContent = 'Entre com seu usuário para consultar seus atendimentos.';return;}
    const {data, error} = await window.supabaseClient.rpc('painel_especialistas_crm', {p_filial:filial,p_agente:document.getElementById('especialistasAgente').value || null,p_apos:especialistasApos,p_busca:document.getElementById('especialistasBusca').value.trim(),p_responsavel:meus ? usuario.nome : null});
    if (numero !== especialistasConsulta || filial !== filialAtual) return;
    if (error || !data) {status.textContent = 'Não foi possível consultar. Atualize para tentar novamente.';return;}
    if (!mais) lista.innerHTML = '';
    const itens = data.itens || [], visiveis = itens.slice(0,50);
    for (const item of visiveis) {
        const card = document.createElement('article');
        const atual = item.estado === 'concluido';
        card.innerHTML = `<strong>${escapeHTML(item.nome || item.pessoa)}</strong><span>${escapeHTML(nomesEspecialistas[item.agente] || item.agente)}</span><small>${atual ? 'Qualificação atualizada' : 'Qualificação pendente ou em processamento: ' + escapeHTML(item.estado)}${item.analisado_em ? ' · última análise ' + escapeHTML(new Date(item.analisado_em).toLocaleString('pt-BR')) : ''}</small><small>Responsável: ${escapeHTML(item.acompanhamento?.responsavel || 'Sem responsável')} · Próximo passo: ${escapeHTML(item.acompanhamento?.proximo || 'A definir')}${item.acompanhamento?.proxima_em ? ' · ' + escapeHTML(new Date(item.acompanhamento.proxima_em).toLocaleString('pt-BR')) : ''}</small>${item.resultado?.evidencia?.trecho ? `<blockquote>${escapeHTML(item.resultado.evidencia.trecho)}</blockquote>` : '<small>Sem declaração textual suficiente para especializar.</small>'}${item.resultado?.inconclusiva ? `<small>${escapeHTML(item.resultado.inconclusiva)}</small>` : ''}${item.erro ? `<small>${escapeHTML(item.erro)}</small>` : ''}<div><button type="button" class="btn-toggle especialista-abrir">Abrir atendimento</button> <button type="button" class="btn-secondary especialista-historico">Ver passagens</button></div><div class="especialista-passagens"></div>`;
        card.querySelector('.especialista-abrir').addEventListener('click', () => abrirAcompanhamentoDaFila(item.pessoa));
        card.querySelector('.especialista-historico').addEventListener('click', () => carregarPassagensEspecialista(item,card.querySelector('.especialista-passagens')));
        lista.append(card);
    }
    especialistasApos = visiveis.length ? visiveis[visiveis.length-1].pessoa : especialistasApos;
    document.getElementById('especialistasMais').hidden = itens.length <= 50;
    const p = data.processamento || {}, a = data.audios || {}, c = data.config || {}, o = data.orcamento || {};
    status.textContent = `${p.concluidos || 0}/${p.total || 0} processados (${p.sem_historico || 0} sem histórico, por regra) · ${p.pendentes || 0} pendentes · ${p.erros || 0} com erro/limite. Áudios: ${a.concluidos || 0}/${a.total || 0} transcritos. ${c.transcricao_disponivel ? 'Transcrição habilitada.' : 'Transcrição aguarda configuração do provedor.'} Orçamento diário da operação: ${o.caracteres || 0}/${c.caracteres_dia || 0} caracteres e ${o.audios || 0}/${c.audios_dia || 0} tentativas de áudio. Nenhum contato é enviado por esta fila.`;
    document.getElementById('especialistasContagens').textContent = Object.entries(data.resumo || {}).map(([chave,total]) => `${nomesEspecialistas[chave] || chave}: ${total}`).join(' · ');
}
async function carregarPassagensEspecialista(item,el) {
    el.textContent = 'Consultando…';
    const {data,error} = await window.supabaseClient.rpc('historico_especialistas_crm',{p_filial:item.filial,p_pessoa:item.pessoa});
    if(error){el.textContent='Histórico indisponível.';return;}
    el.innerHTML = (data || []).map(p => `<p>${escapeHTML(new Date(p.criado_em).toLocaleString('pt-BR'))} · ${escapeHTML(nomesEspecialistas[p.anterior] || 'Sem etapa anterior')} → ${escapeHTML(nomesEspecialistas[p.atual] || p.atual)}${p.motivo ? '<br>' + escapeHTML(p.motivo) : ''}${p.evidencia?.trecho ? '<br>' + escapeHTML(p.evidencia.trecho) : ''}</p>`).join('') || 'Ainda não há passagens registradas.';
}
async function carregarMetricasEspecialistas() {
    const el = document.getElementById('especialistasMetricas'), filial = filialAtual;
    if(!filial)return;
    el.textContent='Consultando…';
    const agora = new Date(), inicio = new Date(agora.getTime()-30*86400000);
    const [consumo,resultados] = await Promise.all([
        window.supabaseClient.rpc('consumo_especialistas_crm',{p_dias:30}),
        window.supabaseClient.rpc('resultados_especialistas_crm',{p_filial:filial,p_inicio:inicio.toISOString(),p_fim:agora.toISOString()})
    ]);
    if(filial !== filialAtual)return;
    if(consumo.error || resultados.error){el.textContent='Métricas indisponíveis.';return;}
    el.innerHTML='<p>Últimos 30 dias. Resultados comprovados dos contatos agrupados pelo agente atual; não atribuem causalidade nem calculam comissão. Consumo é da operação inteira. USD estimado para Haiku 4.5: entrada US$ 1, saída US$ 5, cache criado US$ 1,25 e lido US$ 0,10 por milhão de tokens (referência em 22/10/2026). Não é fatura, não inclui câmbio, impostos nem modelos sem tarifa.</p>';
    const tabela = (cabecalhos,linhas) => '<div class="especialistas-tabela"><table><thead><tr>'+cabecalhos.map(c=>'<th>'+escapeHTML(c)+'</th>').join('')+'</tr></thead><tbody>'+linhas.map(l=>'<tr>'+l.map(c=>'<td>'+escapeHTML(String(c ?? 0))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    el.innerHTML+=tabela(['Agente','Contatados','Inscrições','Presenças','Matrículas'],(resultados.data||[]).map(r=>[nomesEspecialistas[r.agente]||r.agente,r.contatados,r.inscricoes,r.presencas,r.matriculas]));
    el.innerHTML+=tabela(['Rotina','Chamadas','Entrada','Saída','Cache lido','Cache criado','USD estimado','Sem tarifa'],(consumo.data||[]).map(r=>[r.function_name,r.chamadas,r.entrada,r.saida,r.cache_lido,r.cache_criado,r.usd_estimado == null ? 'Não calculado' : r.usd_estimado,r.sem_tarifa]));
}

function limparEspecialistas() {
    especialistasConsulta++; especialistasApos = null;
    ['especialistasLista','especialistasContagens','especialistasMetricas'].forEach(id => document.getElementById(id)?.replaceChildren());
    const status = document.getElementById('especialistasStatus'); if(status)status.textContent='Atualize para consultar a escola selecionada.';
    const mais = document.getElementById('especialistasMais'); if(mais)mais.hidden=true;
}
