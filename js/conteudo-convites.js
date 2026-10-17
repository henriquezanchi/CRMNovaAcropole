// Planejamento de textos públicos por atividade. Sem tokens, anexos ou publicação automática.
let conteudoEventoAtual = null;
let conteudoConsulta = 0;
let conteudoSalvando = false;

async function carregarConteudoConvites() {
    const el = document.getElementById('conteudoConvitesLista');
    if (!el) return;
    const consulta = ++conteudoConsulta;
    const filial = filialAtual;
    conteudoEventoAtual = null;
    document.getElementById('conteudoConvitesEditor').replaceChildren();
    if (!filial) { el.textContent = 'Selecione uma escola.'; return; }
    el.textContent = 'Buscando atividades da escola…';
    try {
        const linhas = [];
        for (let inicio = 0; ; inicio += 1000) {
            const { data, error } = await window.supabaseClient.from('eventos').select('id,nome,tipo,data,hora,filial,planejamento_conteudo')
                .eq('filial', filial).eq('ativo', true).order('id').range(inicio, inicio + 999);
            if (consulta !== conteudoConsulta || filial !== filialAtual) return;
            if (error) throw new Error('Planejamento indisponível. Verifique a atualização do banco.');
            linhas.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        linhas.sort((a, b) => b.data.localeCompare(a.data));
        el.replaceChildren();
        if (!linhas.length) { el.textContent = 'Cadastre uma atividade na Agenda para organizar o convite.'; return; }
        linhas.forEach(evento => {
            const botao = document.createElement('button');
            botao.type = 'button'; botao.className = 'btn-toggle';
            botao.textContent = `${evento.data.split('-').reverse().join('/')} · ${evento.nome}`;
            botao.addEventListener('click', () => abrirPlanejamentoConteudo(evento));
            el.append(botao);
        });
    } catch (erro) { if (consulta === conteudoConsulta) el.textContent = erro.message; }
}
function abrirPlanejamentoConteudo(evento) {
    if (evento.filial !== filialAtual) return;
    conteudoEventoAtual = evento;
    const dado = evento.planejamento_conteudo || {};
    const el = document.getElementById('conteudoConvitesEditor');
    el.innerHTML = `<h3>${escapeHTML(evento.nome)}</h3><p>Use a Agenda para confirmar informações e acompanhar participantes. Este planejamento não publica nem aprova materiais institucionalmente.</p>
        <form id="conteudoConvitesForm"><fieldset><div class="acompanhamento-grade">
        <label>Objetivo<select name="objetivo"><option value="conhecer">Apresentar a escola</option><option value="participar">Convidar para atividade</option><option value="retornar">Convidar para retornar</option></select></label>
        <label>Situação<select name="situacao"><option value="ideia">Ideia</option><option value="producao">Em produção</option><option value="revisao">Revisão interna</option><option value="escola">Aguardando retorno da escola</option><option value="publicado">Publicado manualmente</option><option value="cancelado">Cancelado</option></select></label>
        <label>Responsável<input name="responsavel" maxlength="120"></label><label>Data prevista<input name="data_prevista" type="date"></label></div>
        <label>Texto / roteiro<textarea name="texto" maxlength="5000" rows="5"></textarea></label>
        <label>Próximo passo para o público<input name="convite" maxlength="300" placeholder="Ex.: conhecer a apresentação de sábado"></label>
        <label>Link para informações ou inscrição<input name="destino" type="url" placeholder="https://…"></label>
        <label>Endereço da publicação realizada<input name="publicacao" type="url" placeholder="https://…"></label>
        <button type="submit" class="btn-mini btn-primary-mini">Salvar planejamento</button><span id="conteudoConvitesResultado" role="status" aria-live="polite"></span></fieldset></form>`;
    const formulario = document.getElementById('conteudoConvitesForm');
    ['objetivo', 'situacao', 'responsavel', 'data_prevista', 'texto', 'convite', 'destino', 'publicacao'].forEach(chave => { if (dado[chave]) formulario.elements.namedItem(chave).value = dado[chave]; });
    formulario.addEventListener('submit', eventoSubmit => { eventoSubmit.preventDefault(); salvarPlanejamentoConteudo(evento); });
}
function validarPlanejamentoConteudo(valores) {
    if (!['conhecer', 'participar', 'retornar'].includes(valores.objetivo) || !['ideia', 'producao', 'revisao', 'escola', 'publicado', 'cancelado'].includes(valores.situacao)) throw new Error('Escolha objetivo e situação válidos.');
    if (!valores.responsavel.trim()) throw new Error('Informe quem acompanha este material.');
    if (valores.texto.length > 5000 || valores.convite.length > 300 || valores.responsavel.length > 120) throw new Error('Resuma o texto antes de salvar.');
    ['destino', 'publicacao'].forEach(chave => { if (valores[chave]) { const url = new URL(valores[chave]); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use links HTTPS sem credenciais.'); } });
    if (valores.situacao === 'publicado' && !valores.publicacao) throw new Error('Informe o endereço da publicação realizada.');
    return valores;
}
async function salvarPlanejamentoConteudo(evento) {
    if (conteudoSalvando || evento.filial !== filialAtual) return;
    const formulario = document.getElementById('conteudoConvitesForm');
    const retorno = document.getElementById('conteudoConvitesResultado');
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    if (!usuario) { retorno.textContent = 'Entre novamente para registrar o planejamento.'; return; }
    try {
        conteudoSalvando = true;
        const dado = validarPlanejamentoConteudo(Object.fromEntries(new FormData(formulario)));
        dado.atualizado_em = new Date().toISOString(); dado.atualizado_por = usuario.nome;
        dado.revisao = (evento.planejamento_conteudo?.revisao || 0) + 1;
        formulario.querySelector('fieldset').disabled = true;
        const { data, error } = await window.supabaseClient.from('eventos').update({ planejamento_conteudo: dado })
            .eq('id', evento.id).eq('filial', evento.filial).eq('planejamento_conteudo', JSON.stringify(evento.planejamento_conteudo || {})).select('id,planejamento_conteudo');
        if (error) throw new Error('Não foi possível salvar. Confira a atualização do banco.');
        if (!data || data.length !== 1) throw new Error('O planejamento mudou em outra sessão. Atualize antes de editar.');
        evento.planejamento_conteudo = data[0].planejamento_conteudo;
        retorno.textContent = 'Planejamento salvo. A publicação permanece manual.';
    } catch (erro) { retorno.textContent = erro.message; }
    finally { conteudoSalvando = false; if (formulario.isConnected) formulario.querySelector('fieldset').disabled = false; }
}
