// Relatório da conferência nacional; decisões de identidade ambígua ficam com a equipe.
let auditoriaBaseConsulta = 0;
let auditoriaBaseCasos = [];
let auditoriaBaseCursor = null;
let auditoriaBaseBuscaTimer;
function iniciarPainelAuditoriaBase() {
 const box=document.getElementById('painelAuditoriaBase');if(!box)return;
 if(!document.getElementById('auditoriaBaseDados'))box.innerHTML=`<h3>Auditoria da situação e duplicidades</h3><p>A situação de cada lead foi comparada com a base nacional do Mercúrio, incluindo ativos e inativos. Coincidência de nome ou ausência na base não vira uma classificação automática de inativo.</p><div class="auditoria-controles"><label>Escolas<select id="auditoriaBaseEscopo"><option value="atual">Escola selecionada</option><option value="todas">Todas as escolas</option></select></label><label>Conferir<select id="auditoriaBaseTipo"><option value="duplicidade">Possíveis duplicidades</option><option value="identidade">Identidade / situação a confirmar</option><option value="todos">Todos os casos</option></select></label><label>Encontrar contato<input id="auditoriaBaseBusca" type="search" placeholder="Nome ou identificação"></label><button class="btn-primary" onclick="carregarAuditoriaBase()">Atualizar auditoria</button></div><div id="auditoriaBaseResumo" role="status"></div><div id="auditoriaBaseDados" aria-live="polite"></div><button id="auditoriaBaseMais" class="btn-secondary" hidden onclick="carregarAuditoriaBase(true)">Carregar mais casos</button><div id="auditoriaBaseReconsultas"></div>`;
 document.getElementById('auditoriaBaseEscopo').onchange=()=>carregarAuditoriaBase();document.getElementById('auditoriaBaseTipo').onchange=()=>carregarAuditoriaBase();
 document.getElementById('auditoriaBaseBusca').oninput=()=>{clearTimeout(auditoriaBaseBuscaTimer);auditoriaBaseBuscaTimer=setTimeout(()=>carregarAuditoriaBase(),300);};
}
async function carregarAuditoriaBase(mais=false) {
 iniciarPainelAuditoriaBase();const box=document.getElementById('auditoriaBaseDados');if(!box)return;
 const versao=++auditoriaBaseConsulta;
 if(!mais){auditoriaBaseCursor=null;auditoriaBaseCasos=[];box.textContent='Consultando auditoria…';}
 const botao=document.getElementById('auditoriaBaseMais');botao.disabled=true;
 try {
  const {data,error}=await window.supabaseClient.rpc('painel_auditoria_crm',{p_filial:document.getElementById('auditoriaBaseEscopo').value==='todas'?null:filialAtual,p_tipo:document.getElementById('auditoriaBaseTipo').value,p_apos:auditoriaBaseCursor,p_busca:document.getElementById('auditoriaBaseBusca').value.trim()});
  if(versao!==auditoriaBaseConsulta)return;if(error)throw error;
  const novas=data?.casos||[];auditoriaBaseCasos.push(...novas);auditoriaBaseCursor=novas.at(-1)?.id||auditoriaBaseCursor;
  const r=data?.resumo||{},n=v=>Number(v||0).toLocaleString('pt-BR');
  document.getElementById('auditoriaBaseResumo').innerHTML=`<div class="auditoria-numeros"><span><strong>${n(r.leads)}</strong> leads conferidos</span><span><strong>${n(r.confirmados)}</strong> situações confirmadas</span><span><strong>${n(r.corrigidos)}</strong> tags ajustadas</span><span><strong>${n(r.conferir)}</strong> identidades a conferir</span></div><p>${n(r.sem_registro)} sem correspondência confirmada na fonte; não foram marcados como inativos por isso. <strong>${n(data?.total_casos)} casos neste filtro</strong>; ${auditoriaBaseCasos.length} exibidos. Um contato pode aparecer em mais de um indício. Fonte coletada em ${data?.execucao?.criado_em?escapeHTML(new Date(data.execucao.criado_em).toLocaleString('pt-BR')):'data não disponível'}.</p>`;
  box.innerHTML=auditoriaBaseCasos.map((c,i)=>{
   const leads=[...new Map((c.leads||[]).map(l=>[l.pessoa,l])).values()];
   return `<article class="auditoria-caso" data-caso="${i}"><h4>${escapeHTML(c.motivo)}</h4><p>${escapeHTML(c.filial||'Entre escolas')} · caso ${Number(c.id)}</p>${leads.map((l,j)=>`<div class="auditoria-pessoa">${leads.length>1?`<input type="checkbox" data-selecionar-auditoria="${escapeHTML(l.pessoa)}" aria-label="Selecionar ${escapeHTML(l.nome||l.pessoa)}">`:''}<div><strong>${escapeHTML(l.nome||l.pessoa)}</strong><p>${escapeHTML(l.filial||'')} · ID ${escapeHTML(l.pessoa)}${l.matricula?' · Mercúrio '+Number(l.matricula):''}</p><small>${escapeHTML(l.telefone||'Sem telefone')} · ${escapeHTML(l.email||'Sem e-mail')}</small></div><button class="btn-secondary" data-abrir-auditoria="${j}">Abrir cadastro</button></div>`).join('')}
   ${(c.evidencias||[]).length?`<details><summary>Correspondências possíveis no Mercúrio</summary>${c.evidencias.map(e=>`<p>${escapeHTML(e.nome||'Registro na fonte')} · matrícula ${Number(e.matricula)} · ${escapeHTML(e.unidade||'')} ${e.situacao==='ATI'?'· Ativo':e.situacao==='INA'?'· Inativo':''}</p>`).join('')}</details>`:''}
   <div class="auditoria-acoes">${leads.length>1?'<button class="btn-primary" data-mesclar-auditoria disabled>Comparar e mesclar selecionados</button><button class="btn-secondary" data-descartar-auditoria>Não são duplicados</button>':'<small>Confira a identidade antes de alterar o cadastro. Nenhuma unificação foi feita automaticamente.</small>'}</div></article>`;
  }).join('')||'<p>Nenhum caso pendente neste filtro.</p>';
  box.querySelectorAll('.auditoria-caso').forEach(card=>{
   const caso=auditoriaBaseCasos[Number(card.dataset.caso)],leads=[...new Map((caso.leads||[]).map(l=>[l.pessoa,l])).values()];
   card.querySelectorAll('[data-selecionar-auditoria]').forEach(c=>c.onchange=()=>{card.querySelector('[data-mesclar-auditoria]').disabled=card.querySelectorAll('input:checked').length<2;});
   card.querySelector('[data-mesclar-auditoria]')?.addEventListener('click',()=>abrirModalMesclarManual([...card.querySelectorAll('input:checked')].map(c=>c.dataset.selecionarAuditoria)));
   card.querySelector('[data-descartar-auditoria]')?.addEventListener('click',async()=>{
    if(!confirm('Registrar que este grupo não deve ser mesclado? Nenhum cadastro será apagado.'))return;
    const {error}=await window.supabaseClient.rpc('descartar_caso_auditoria',{p_id:caso.id,p_autor:(typeof usuarioLogado==='function'?usuarioLogado()?.nome:'')||'Equipe CRM'});if(error){alert(error.message);return;}carregarAuditoriaBase();
   });
   card.querySelectorAll('[data-abrir-auditoria]').forEach(b=>b.onclick=()=>abrirContatoDaAuditoria(leads[Number(b.dataset.abrirAuditoria)]));
  });
  botao.hidden=novas.length<50||auditoriaBaseCasos.length>=Number(data?.total_casos||0);
  document.getElementById('auditoriaBaseReconsultas').innerHTML=`<h4>Consulta de ativos após mesclagens</h4><p>Ao concluir uma mesclagem, só o cadastro sobrevivente entra na fila de nova consulta. A rodada automática começa em aproximadamente um minuto. Não encontrar alguém entre os ativos não o transforma automaticamente em inativo.</p>${(data?.reconsultas||[]).map(q=>`<p>${escapeHTML(q.nome||q.pessoa)} · ${escapeHTML(q.resultado||({'pendente':'Aguardando consulta','processando':'Consultando','erro':'Falha: nova tentativa programada'}[q.estado]||q.estado))}</p>`).join('')||'<p>Nenhuma reconsulta solicitada por mesclagem até agora.</p>'}`;
 }catch(e){if(versao===auditoriaBaseConsulta)box.textContent='Não foi possível consultar a auditoria: '+e.message;}
 finally{if(versao===auditoriaBaseConsulta)botao.disabled=false;}
}
async function abrirContatoDaAuditoria(lead) {
 if(lead.filial!==filialAtual){const s=document.getElementById('filialSelect');if(s)s.value=lead.filial;trocarFilial(lead.filial);}
 switchModule('tab-crm','Atendimento','Acolhimento e acompanhamento dos interessados');await abrirAcompanhamentoDaFila(lead.pessoa);
}
