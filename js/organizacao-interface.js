// Organização visual progressiva: preserva IDs e dados usados pelos módulos existentes.
function organizarInterfaceCrm() {
    if (document.body.dataset.organizado === 'sim') return;
    document.body.dataset.organizado = 'sim';
    const envolver = (elemento, titulo, aberto = false) => {
        if (!elemento) return null;
        const detalhes = document.createElement('details'); detalhes.className = 'secao-organizada'; detalhes.open = aberto;
        const resumo = document.createElement('summary'); resumo.textContent = titulo;
        elemento.before(detalhes); detalhes.append(resumo, elemento); return detalhes;
    };
    const dashboard = document.querySelector('#tab-dashboard .dashboard-content');
    if (dashboard) {
        const kpis = dashboard.querySelector('.kpi-grid'); if (kpis) dashboard.prepend(kpis);
        const diagnostico = document.getElementById('diagnosticoIaCard'); if (diagnostico) { const grupo = envolver(diagnostico, 'Saúde dos dados e sincronizações'); dashboard.append(grupo); }
        const grade = dashboard.querySelector('.agenda-geral-grid');
        if (grade) {
            const idsExtras = ['agendaGeralAniversariantes','agendaGeralInstagram','agendaGeralCalendario'];
            const extras = document.createElement('details'); extras.className = 'secao-organizada rotinas-extras';
            const resumo = document.createElement('summary'); resumo.textContent = 'Calendário e outras rotinas'; extras.append(resumo);
            idsExtras.forEach(id => { const bloco = document.getElementById(id)?.closest('.activity-card'); if (bloco) extras.append(bloco); }); grade.append(extras);
        }
        const explorar = document.createElement('details'); explorar.className = 'secao-organizada';
        const tituloExplorar = document.createElement('summary'); tituloExplorar.textContent = 'Explorar perfil e histórico da base'; explorar.append(tituloExplorar);
        ['leadForteResumo','jornadaCard','retorno1EventoCard'].forEach(id => { const el = document.getElementById(id); const card = el?.classList.contains('activity-card') ? el : el?.closest('.activity-card'); if (card) explorar.append(card); });
        if (explorar.children.length > 1) dashboard.append(explorar);
        ['aniversariantesFeed','activityFeed'].forEach(id => { const card = document.getElementById(id)?.closest('.activity-card'); if (card) envolver(card, id === 'activityFeed' ? 'Histórico de atividades da equipe' : 'Aniversariantes do mês'); });
    }
    const relatorios = document.querySelector('#tab-relatorios .report-content');
    if (relatorios) {
        const grupos = [
            ['Panorama anual', ['relatorioAnualMatriculas']],
            ['Matrículas e conferência', ['relatorioMatriculasPorMes','relatorioConciliacaoMercurio']],
            ['Comissões e cobrança', ['relatorioComissaoSdrTodasFiliais','relatorioCobrancaMensal','relatorioCiclosTurma']],
            ['Funil e relacionamento', ['funilInteracoes','relatorioKanbanCabecalho','funnelChart','relatorioJornadaBase','relatorioTemasEvento','relatorioCanalOrigemMercurio','relatorioMotivosPerda','relatorioComparacaoFiliais']],
            ['Atendimento e equipe', ['relatorioSlaWhatsApp','resumoTrabalhoContainer']],
        ];
        const navegacao = document.createElement('nav'); navegacao.className = 'atalhos-relatorios'; navegacao.setAttribute('aria-label','Assuntos dos relatórios');
        const cabecalho = document.createElement('header'); cabecalho.className = 'relatorios-intro';
        cabecalho.innerHTML = '<span>VISÃO DE GESTÃO</span><h1>Relatórios</h1><p>Escolha um assunto para analisar os resultados com mais clareza.</p>';
        const secoes = [], botoes = [];
        grupos.forEach(([titulo, ids], indice) => {
            const secao = document.createElement('section'); secao.className = 'relatorios-assunto'; secao.id = 'relatorios-assunto-' + indice;
            secao.setAttribute('aria-label',titulo);
            ids.forEach(id => {
                let bloco = document.getElementById(id);
                if (!bloco) return;
                while (bloco.parentElement && bloco.parentElement !== relatorios) bloco = bloco.parentElement;
                if (bloco.parentElement === relatorios) { bloco.style.marginTop = ''; bloco.classList.add('relatorio-bloco'); secao.append(bloco); }
            });
            if (!secao.children.length) return;
            relatorios.append(secao); secoes.push(secao);
            const botao = document.createElement('button'); botao.type = 'button'; botao.textContent = titulo;
            botao.setAttribute('aria-controls',secao.id);
            botao.addEventListener('click', () => {
                secoes.forEach(s => { s.hidden = s !== secao; });
                botoes.forEach(b => b.setAttribute('aria-pressed',String(b === botao)));
                try { sessionStorage.setItem('crm_relatorios_assunto',secao.id); } catch { /* armazenamento indisponível */ }
            });
            botoes.push(botao); navegacao.append(botao);
        });
        relatorios.prepend(cabecalho,navegacao);
        let selecionada = 'relatorios-assunto-0';
        try { selecionada = sessionStorage.getItem('crm_relatorios_assunto') || selecionada; } catch { /* usa panorama */ }
        const atual = secoes.find(s => s.id === selecionada) || secoes[0];
        secoes.forEach(s => { s.hidden = s !== atual; });
        botoes.forEach(b => b.setAttribute('aria-pressed',String(b.getAttribute('aria-controls') === atual?.id)));
    }
}
document.addEventListener('DOMContentLoaded', organizarInterfaceCrm);
