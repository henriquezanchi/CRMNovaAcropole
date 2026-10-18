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
            const idsExtras = ['agendaGeralAniversariantes','agendaGeralInstagram','agendaGeralAtraso','agendaGeralCalendario'];
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
            ['Matrículas e conferência', ['relatorioMatriculasPorMes','relatorioConciliacaoMercurio'], true],
            ['Cobranças e ciclos', ['relatorioCobrancaMensal','relatorioCiclosTurma','relatorioComissaoSdrTodasFiliais'], false],
            ['Origem e relacionamento', ['relatorioJornadaBase','relatorioTemasEvento','relatorioCanalOrigemMercurio','relatorioMotivosPerda','relatorioComparacaoFiliais'], false],
            ['Atendimento e equipe', ['relatorioSlaWhatsApp','resumoTrabalhoContainer'], false],
        ];
        const navegacao = document.createElement('nav'); navegacao.className = 'atalhos-relatorios'; navegacao.setAttribute('aria-label','Assuntos dos relatórios');
        relatorios.prepend(navegacao);
        grupos.forEach(([titulo, ids, aberto]) => {
            const detalhes = document.createElement('details'); detalhes.className = 'secao-organizada'; detalhes.open = aberto;
            const resumo = document.createElement('summary'); resumo.textContent = titulo; detalhes.append(resumo);
            ids.forEach(id => {
                let bloco = document.getElementById(id);
                if (!bloco) return;
                while (bloco.parentElement && bloco.parentElement !== relatorios) bloco = bloco.parentElement;
                if (bloco.parentElement === relatorios) { bloco.style.marginTop = ''; detalhes.append(bloco); }
            });
            if (detalhes.children.length === 1) return;
            relatorios.append(detalhes);
            const botao = document.createElement('button'); botao.type = 'button'; botao.textContent = titulo;
            botao.addEventListener('click', () => { detalhes.open = true; resumo.scrollIntoView({block:'start',behavior:'auto'}); resumo.focus(); });
            resumo.tabIndex = 0; navegacao.append(botao);
        });
    }
}
document.addEventListener('DOMContentLoaded', organizarInterfaceCrm);
