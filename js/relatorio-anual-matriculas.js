// Estatística acadêmica anual, independente da regra financeira por ciclo.
let anoRelatorioMatriculas = 2026;
let escolaRelatorioAnual = 'todas';
let metricaRelatorioAnual = 'novas';
let dadosRelatorioAnual = [];
let versaoRelatorioAnual = 0;
const MESES_ANUAL = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function resumirMatriculasAnuais(dados, filiais, metrica = 'novas') {
    const bases = filiais.filter(f => !f.filial_cobranca_id);
    const escolas = bases.map(f => {
        const minhas = dados.filter(d => String(d.filial_id) === String(f.id));
        const porMes = Array.from({length:12},(_,i) => minhas.find(d => Number(d.mes) === i+1));
        const valores = porMes.map(d => !d || d.novas == null || (metrica !== 'novas' && d.reingressos == null) ? null : Number(d.novas) + (metrica === 'total' ? Number(d.reingressos) : 0));
        const recente = minhas.slice().sort((a,b)=>b.fonte_data.localeCompare(a.fonte_data))[0];
        const membros = recente?.membros_referencia == null ? null : Number(recente.membros_referencia);
        const total = valores.some(v=>v!=null) ? valores.reduce((s,v)=>s+(v??0),0) : null;
        const filhas = filiais.filter(g => String(g.filial_cobranca_id) === String(f.id));
        return { id:f.id, nome:f.nome, rotulo: f.nome + (filhas.length ? ' + ' + filhas.map(g=>g.nome).join(', ') : ''), porMes, valores, total, membros,
            taxa: total == null || !membros ? null : total / membros * 100 };
    });
    const meses = Array.from({length:12},(_,i)=>{
        const valores = escolas.map(e=>e.valores[i]);
        const completo = escolas.length>0 && escolas.every(e=>e.porMes[i] && !e.porMes[i].parcial && e.valores[i]!=null);
        return {mes:i+1,total:valores.length && valores.every(v=>v!=null) ? valores.reduce((s,v)=>s+v,0) : null,
            parcial: escolas.some(e=>e.porMes[i]?.parcial), completo};
    });
    return { escolas, meses, total:escolas.some(e=>e.total==null) ? null : escolas.reduce((s,e)=>s+e.total,0),
        membros:escolas.some(e=>e.membros==null) ? null : escolas.reduce((s,e)=>s+e.membros,0),
        melhores:meses.filter(m=>m.completo).sort((a,b)=>b.total-a.total||a.mes-b.mes) };
}
function curvaSvgAnual(meses, ano, titulo) {
    const largura=920,altura=280,esq=48,dir=22,topo=28,base=238;
    const maximo=Math.max(1,...meses.map(m=>m.total??0));
    const teto=Math.max(5,Math.ceil(maximo/5)*5);
    const x=i=>esq+i*(largura-esq-dir)/11, y=v=>base-v/teto*(base-topo);
    let linha='',area='',trecho=[];
    const fechar=()=>{
        if(!trecho.length)return;
        let p=`M ${x(trecho[0].i).toFixed(2)} ${y(trecho[0].v).toFixed(2)}`;
        for(let n=1;n<trecho.length;n++){
            const a=trecho[n-1],b=trecho[n],meio=(x(a.i)+x(b.i))/2;
            p+=` C ${meio.toFixed(2)} ${y(a.v).toFixed(2)}, ${meio.toFixed(2)} ${y(b.v).toFixed(2)}, ${x(b.i).toFixed(2)} ${y(b.v).toFixed(2)}`;
        }
        linha+=p+' ';
        area+=p+` L ${x(trecho.at(-1).i).toFixed(2)} ${base} L ${x(trecho[0].i).toFixed(2)} ${base} Z `;
        trecho=[];
    };
    meses.forEach((m,i)=>{if(m.total==null)fechar();else trecho.push({i,v:m.total});});fechar();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="${escapeHTML(titulo)}" class="anual-curva"><title>${escapeHTML(titulo)}</title>
        <rect width="920" height="280" fill="white"/>
        ${[0,1,2,3,4].map(n=>{const v=teto*n/4;return `<line x1="${esq}" x2="${largura-dir}" y1="${y(v)}" y2="${y(v)}" stroke="#edf1ef"/><text x="${esq-12}" y="${y(v)+4}" text-anchor="end" fill="#72827c" font-size="11">${Number(v.toFixed(1))}</text>`;}).join('')}
        <path d="${area}" fill="#e9f4f0"/><path d="${linha}" fill="none" stroke="#398978" stroke-width="3" stroke-linecap="round"/>
        ${meses.map((m,i)=>`<text x="${x(i)}" y="263" text-anchor="middle" fill="#72827c" font-size="11">${MESES_ANUAL[i]}${m.parcial?'*':''}</text>${m.total==null?'':`<g tabindex="0" role="img" aria-label="${MESES_ANUAL[i]}/${ano}: ${m.total} matrículas${m.parcial?', mês parcial':''}"><title>${MESES_ANUAL[i]}/${ano}: ${m.total}${m.parcial?' (parcial)':''}</title><circle cx="${x(i)}" cy="${y(m.total)}" r="5" fill="${m.parcial?'white':'#398978'}" stroke="#398978" stroke-width="2"/><text x="${x(i)}" y="${y(m.total)-13}" text-anchor="middle" fill="#335e53" font-size="12">${m.total}</text></g>`}`).join('')}
    </svg>`;
}
async function carregarRelatorioAnualMatriculas() {
    const container=document.getElementById('relatorioAnualMatriculas'); if(!container)return;
    const versao=++versaoRelatorioAnual;
    container.innerHTML='<p class="report-sub">Carregando o panorama anual…</p>';
    try {
        const linhas=[];
        for(let de=0;;de+=1000){
            const {data,error}=await window.supabaseClient.from('relatorio_matriculas_mensais').select('*').eq('ano',anoRelatorioMatriculas)
                .order('filial_id').order('mes').range(de,de+999);
            if(error)throw error;linhas.push(...(data||[]));if(!data||data.length<1000)break;
        }
        if(versao!==versaoRelatorioAnual)return;
        dadosRelatorioAnual=linhas;renderizarRelatorioAnualMatriculas();
    } catch(e){if(versao===versaoRelatorioAnual)container.innerHTML=`<p class="report-sub">Não foi possível carregar o relatório: ${escapeHTML(e.message||String(e))}</p>`;}
}
function renderizarRelatorioAnualMatriculas() {
    const container=document.getElementById('relatorioAnualMatriculas');if(!container)return;
    if(!dadosRelatorioAnual.length){container.innerHTML='<p class="report-sub">O panorama anual ainda não foi sincronizado para este ano.</p>';return;}
    const filiais=typeof filiaisDisponiveis!=='undefined'?filiaisDisponiveis:[];
    const resumo=resumirMatriculasAnuais(dadosRelatorioAnual,filiais,metricaRelatorioAnual);
    if(!resumo.escolas.some(e=>String(e.id)===escolaRelatorioAnual))escolaRelatorioAnual='todas';
    const escola=resumo.escolas.find(e=>String(e.id)===escolaRelatorioAnual);
    const meses=escola?escola.valores.map((v,i)=>({mes:i+1,total:v,parcial:!!escola.porMes[i]?.parcial,completo:escola.porMes[i]&&!escola.porMes[i].parcial&&v!=null})):resumo.meses;
    const melhores=meses.filter(m=>m.completo).sort((a,b)=>b.total-a.total||a.mes-b.mes);
    const melhor=melhores[0],total=escola?escola.total:resumo.total;
    const ranking=resumo.escolas.filter(e=>e.taxa!=null).sort((a,b)=>b.taxa-a.taxa||b.total-a.total);
    const volume=resumo.escolas.filter(e=>e.total!=null).sort((a,b)=>b.total-a.total)[0];
    const membros=escola?escola.membros:resumo.membros;
    const taxa=total==null||!membros?null:total/membros*100;
    const fontes=[...new Set(dadosRelatorioAnual.map(d=>d.fonte_data))].sort();
    const fmt=n=>n==null?'—':Number(n).toLocaleString('pt-BR',{maximumFractionDigits:1});
    const nomeMetrica=metricaRelatorioAnual==='novas'?'Novos ingressos':'Ingressos + reingressos';
    const titulo=`${nomeMetrica} em ${anoRelatorioMatriculas} · ${escola?.rotulo||'Todas as escolas'}`;
    const top3=melhores.slice(0,3),somaTop3=top3.reduce((s,m)=>s+m.total,0);
    container.innerHTML=`
        <header class="anual-cabecalho"><div><span class="anual-sobre">PANORAMA ${anoRelatorioMatriculas}</span><h2>Matrículas ao longo do ano</h2><p>Uma visão da rede, do ritmo mensal e do desempenho de cada escola.</p></div><button class="btn-secondary" onclick="carregarRelatorioAnualMatriculas()">Atualizar leitura</button></header>
        <div class="anual-filtros"><label>Escola<select onchange="escolaRelatorioAnual=this.value;renderizarRelatorioAnualMatriculas()"><option value="todas">Todas as escolas</option>${resumo.escolas.map(e=>`<option value="${e.id}" ${String(e.id)===escolaRelatorioAnual?'selected':''}>${escapeHTML(e.rotulo)}</option>`).join('')}</select></label>
        <label>Contagem<select onchange="metricaRelatorioAnual=this.value;renderizarRelatorioAnualMatriculas()"><option value="novas" ${metricaRelatorioAnual==='novas'?'selected':''}>Novos ingressos</option><option value="total" ${metricaRelatorioAnual==='total'?'selected':''}>Ingressos + reingressos</option></select></label>
        <span class="anual-fonte">Base ${fontes.map(d=>d.split('-').reverse().join('/')).join(' a ')} · * mês parcial</span></div>
        <div class="anual-indicadores"><article><span>${nomeMetrica} no ano observado</span><strong>${fmt(total)}</strong><small>${escola?escapeHTML(escola.rotulo):'Bases acadêmicas sem duplicar Jataí'}</small></article>
        <article><span>Melhor mês completo</span><strong>${melhor?MESES_ANUAL[melhor.mes-1]:'—'}</strong><small>${melhor?`${fmt(melhor.total)} matrículas`:'Aguardando meses completos'}</small></article>
        <article><span>Matrículas por 100 membros</span><strong>${fmt(taxa)}</strong><small>Referência: ${fmt(membros)} membros atuais</small></article>
        <article><span>Maior volume na rede</span><strong>${fmt(volume?.total)}</strong><small>${escapeHTML(volume?.rotulo||'Sem dados')}</small></article></div>
        <section class="anual-card"><div class="anual-titulo-linha"><div><h3>Curva mensal</h3><p>${escapeHTML(titulo)}</p></div><button class="btn-secondary" onclick="baixarCurvaAnual()">Baixar SVG</button></div><div class="anual-curva-wrap">${curvaSvgAnual(meses,anoRelatorioMatriculas,titulo)}</div><p class="anual-legenda">Passe sobre os pontos para conferir os valores. Meses sem cobertura da fonte ficam vazios; o mês parcial não participa do ranking de melhores meses.</p></section>
        <div class="anual-duas-colunas"><section class="anual-card"><h3>O que os números mostram</h3><div class="anual-analise">
        <p>${melhor?`<strong>${MESES_ANUAL[melhor.mes-1]} lidera os meses completos</strong>, com ${fmt(melhor.total)} matrículas${melhores[1]?`; depois vem ${MESES_ANUAL[melhores[1].mes-1]}, com ${fmt(melhores[1].total)}`:''}.`:'Ainda não há mês completo para comparar.'}</p>
        <p>${top3.length&&total>0?`Os ${top3.length} melhores meses (${top3.map(m=>MESES_ANUAL[m.mes-1]).join(', ')}) concentram <strong>${fmt(somaTop3/total*100)}% do volume observado</strong>.`:'A comparação aparecerá quando houver matrículas na base.'}</p>
        <p>${ranking[0]?`<strong>${escapeHTML(ranking[0].rotulo)}</strong> apresenta o maior índice da rede: ${fmt(ranking[0].taxa)} matrículas por 100 membros (${ranking[0].total} matrículas / ${ranking[0].membros} membros).`:'Não há contagem de membros disponível para o ranking.'}</p>
        <p class="anual-nota">Este índice compara volume com o tamanho atual da escola; não é taxa de conversão nem crescimento líquido. Pode passar de 100 e varia mais nas bases pequenas. Os dados não identificam, por si só, a causa dos picos.</p></div></section>
        <section class="anual-card"><h3>Matrículas por 100 membros</h3><p class="anual-legenda">As seis maiores proporções · ranking completo na tabela abaixo</p><ol class="anual-ranking">${ranking.slice(0,6).map(e=>`<li><div><span>${escapeHTML(e.rotulo)}</span><strong>${fmt(e.taxa)}</strong></div><div class="anual-trilho"><span style="width:${Math.max(1,e.taxa/(ranking[0]?.taxa||1)*100)}%"></span></div><small>${e.total} matrículas · ${e.membros} membros</small></li>`).join('')}</ol></section></div>
        <section class="anual-card"><div class="anual-titulo-linha"><div><h3>Escola por escola, mês a mês</h3><p>${nomeMetrica} · ${anoRelatorioMatriculas}</p></div><button class="btn-secondary" onclick="exportarMatriculasAnuaisCSV()">Exportar CSV</button></div>
        <div class="anual-tabela-wrap"><table class="anual-tabela"><thead><tr><th>Escola</th>${MESES_ANUAL.map(m=>`<th>${m}</th>`).join('')}<th>Total</th><th>Membros</th><th>Por 100</th></tr></thead><tbody>${resumo.escolas.map(e=>`<tr><th>${escapeHTML(e.rotulo)}</th>${e.valores.map((v,i)=>`<td class="${v===0?'anual-zero':''}">${fmt(v)}${e.porMes[i]?.parcial?'*':''}</td>`).join('')}<td><strong>${fmt(e.total)}</strong></td><td>${fmt(e.membros)}</td><td>${fmt(e.taxa)}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total da rede</th>${resumo.meses.map(m=>`<td>${fmt(m.total)}${m.parcial?'*':''}</td>`).join('')}<td>${fmt(resumo.total)}</td><td>${fmt(resumo.membros)}</td><td>${fmt(resumo.total==null||!resumo.membros?null:resumo.total/resumo.membros*100)}</td></tr></tfoot></table></div></section>
        <details class="anual-metodo"><summary>Como este relatório é calculado</summary><p>Novos ingressos usam a data de ingresso no Mercúrio; reingressos usam a data de recuperação válida, posterior ao ingresso. Inclui cadastros ativos e inativos de PP, N1 a N7 e CA. Quem avançou de nível continua contando no ingresso do ano. Janos/Merlin ficam fora. No modo combinado, ingresso e retorno são ocorrências distintas: a mesma pessoa pode aparecer em meses diferentes.</p><p>Jataí compartilha a base de Rio Verde e está consolidada nessa linha. Os membros são a referência atual da fonte, não uma reconstrução do tamanho da escola em cada mês de 2026. Uma transferência de escola ou alteração na fonte pode mudar a atribuição histórica. Esta estatística é acadêmica: não substitui a conciliação financeira por ciclo nem a comprovação da origem comercial da matrícula.</p><p>O banco do Mercúrio atualiza a estatística na rotina diária. “Atualizar leitura” consulta a última sincronização do CRM. Traço significa ausência de cobertura; zero indica mês coberto sem movimento registrado.</p></details>`;
}
function baixarCurvaAnual() {
    const svg=document.querySelector('#relatorioAnualMatriculas .anual-curva');if(!svg)return;
    baixarArquivoAnual(svg.outerHTML,'image/svg+xml',`matriculas_${anoRelatorioMatriculas}.svg`);
}
function baixarArquivoAnual(texto,tipo,nome) {
    const url=URL.createObjectURL(new Blob([texto],{type:tipo}));const a=document.createElement('a');a.href=url;a.download=nome;a.click();URL.revokeObjectURL(url);
}
function exportarMatriculasAnuaisCSV() {
    const resumo=resumirMatriculasAnuais(dadosRelatorioAnual,filiaisDisponiveis,metricaRelatorioAnual);
    const linhas=[['Escola',...MESES_ANUAL,'Total','Membros atuais','Matrículas por 100 membros'],...resumo.escolas.map(e=>[e.rotulo,...e.valores,e.total,e.membros,e.taxa==null?'':e.taxa.toFixed(2)]),['TOTAL',...resumo.meses.map(m=>m.total),resumo.total,resumo.membros,resumo.total==null||!resumo.membros?'':(resumo.total/resumo.membros*100).toFixed(2)]];
    const campo=v=>{let t=String(v??'');if(/^\s*[=+@-]/.test(t)&&!/^\d+(?:\.\d+)?$/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
    baixarArquivoAnual('\ufeff'+linhas.map(l=>l.map(campo).join(';')).join('\r\n'),'text/csv;charset=utf-8',`matriculas_${anoRelatorioMatriculas}_${metricaRelatorioAnual}.csv`);
}
