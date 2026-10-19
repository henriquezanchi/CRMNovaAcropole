// Relatório da conferência nacional; decisões de identidade ambígua ficam com a equipe.
let auditoriaBaseConsulta = 0;
let auditoriaBaseCasos = [];
let auditoriaBaseCursor = null;
let auditoriaBaseBuscaTimer;
function iniciarPainelAuditoriaBase() {
 const box=document.getElementById('painelAuditoriaBase');if(!box)return;
 if(!document.getElementById('auditoriaBaseDados'))box.innerHTML=`<h3>Auditoria da situação e duplicidades</h3><p>A situação de cada lead foi comparada com a base nacional do Mercúrio, incluindo ativos e inativos. Coincidência de nome ou ausência na base não vira uma classificação automática de inativo.</p><p>A mesclagem automática exige nomes compatíveis e contatos coincidentes ou identidade confirmada na fonte oficial. Casos com contato ou histórico em conferência permanecem para análise.</p><div class="auditoria-controles"><label>Escolas<select id="auditoriaBaseEscopo"><option value="atual">Escola selecionada</option><option value="todas">Todas as escolas</option></select></label><label>Conferir<select id="auditoriaBaseTipo"><option value="duplicidade">Possíveis duplicidades</option><option value="contatos">Contatos recuperados / histórico em conferência</option><option value="contatos_pendentes">Contatos suspeitos a conferir</option><option value="identidade">Identidade / situação a confirmar</option><option value="todos">Todos os casos</option></select></label><label>Encontrar contato<input id="auditoriaBaseBusca" type="search" placeholder="Nome ou identificação"></label><button class="btn-primary" onclick="carregarAuditoriaBase()">Atualizar auditoria</button></div><div id="auditoriaBaseResumo" role="status"></div><div id="auditoriaBaseDados" aria-live="polite"></div><button id="auditoriaBaseMais" class="btn-secondary" hidden onclick="carregarAuditoriaBase(true)">Carregar mais casos</button><div id="auditoriaBaseReconsultas"></div>`;
 document.getElementById('auditoriaBaseEscopo').onchange=()=>carregarAuditoriaBase();document.getElementById('auditoriaBaseTipo').onchange=()=>carregarAuditoriaBase();
 document.getElementById('auditoriaBaseBusca').oninput=()=>{clearTimeout(auditoriaBaseBuscaTimer);auditoriaBaseBuscaTimer=setTimeout(()=>carregarAuditoriaBase(),300);};
}
async function carregarAuditoriaBase(mais=false) {
 iniciarPainelAuditoriaBase();const box=document.getElementById('auditoriaBaseDados');if(!box)return;
 if(document.getElementById('auditoriaBaseTipo').value==='contatos')return carregarRecuperacaoContatos(mais);
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
   return `<article class="auditoria-caso" data-caso="${i}"><h4>${escapeHTML(c.motivo)}</h4><p>${escapeHTML(c.filial||'Entre escolas')} · caso ${Number(c.id)}</p>${c.auto_motivo?`<p class="auditoria-decisao"><strong>Análise automática:</strong> ${escapeHTML(c.auto_motivo)}</p>`:''}${leads.map((l,j)=>`<div class="auditoria-pessoa">${leads.length>1?`<input type="checkbox" data-selecionar-auditoria="${escapeHTML(l.pessoa)}" aria-label="Selecionar ${escapeHTML(l.nome||l.pessoa)}">`:''}<div><strong>${escapeHTML(l.nome||l.pessoa)}</strong><p>${escapeHTML(l.filial||'')} · ID ${escapeHTML(l.pessoa)}${l.matricula?' · Mercúrio '+Number(l.matricula):''}</p><small>${escapeHTML(l.telefone||'Sem telefone')} · ${escapeHTML(l.email||'Sem e-mail')}</small></div><button class="btn-secondary" data-abrir-auditoria="${j}">Abrir cadastro</button></div>`).join('')}
   ${(c.evidencias||[]).length?`<details><summary>Correspondências possíveis no Mercúrio</summary>${c.evidencias.map(e=>`<p>${escapeHTML(e.nome||'Registro na fonte')} · matrícula ${Number(e.matricula)} · ${escapeHTML(e.unidade||'')} ${e.situacao==='ATI'?'· Ativo':e.situacao==='INA'?'· Inativo':''}${e.telefone?' · '+escapeHTML(e.telefone):''}${e.email?' · '+escapeHTML(e.email):''}</p>`).join('')}</details>`:''}
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

async function carregarRecuperacaoContatos(mais=false) {
 const box=document.getElementById('auditoriaBaseDados'),botao=document.getElementById('auditoriaBaseMais'),versao=++auditoriaBaseConsulta;
 if(!mais){auditoriaBaseCursor=null;auditoriaBaseCasos=[];box.textContent='Consultando contatos recuperados…';}
 botao.disabled=true;
 try {
  const {data:d,error}=await window.supabaseClient.rpc('painel_recuperacao_contatos',{p_filial:document.getElementById('auditoriaBaseEscopo').value==='todas'?null:filialAtual,p_busca:document.getElementById('auditoriaBaseBusca').value.trim(),p_apos:auditoriaBaseCursor});
  if(versao!==auditoriaBaseConsulta)return;if(error)throw error;
  const novos=d?.casos||[];auditoriaBaseCasos.push(...novos);auditoriaBaseCursor=novos.at(-1)?.id||auditoriaBaseCursor;
  const n=v=>Number(v||0).toLocaleString('pt-BR');
  document.getElementById('auditoriaBaseResumo').innerHTML=`<div class="auditoria-numeros"><span><strong>${n(d.contatos)}</strong> contatos recuperados</span><span><strong>${n(d.ddd)}</strong> DDDs corrigidos</span><span><strong>${n(d.filiais)}</strong> escolas corrigidas</span><span><strong>${n(d.vinculos)}</strong> vínculos em conferência</span></div><p>Contatos recuperados da base oficial com DDD explícito, sem adivinhar pela escola. Históricos com origem duvidosa foram preservados aqui e retirados da medição; não representam inscrições ou presenças comprovadas. Nenhuma mensagem foi enviada nesta recuperação.</p>`;
  box.innerHTML=auditoriaBaseCasos.map((c,i)=>`<article class="auditoria-caso"><h4>${escapeHTML(c.nome)}</h4><p>${escapeHTML(c.filial)} · ID ${escapeHTML(c.destino)} · Mercúrio ${escapeHTML(c.matricula)} / ${escapeHTML(c.unidade)}</p><p><strong>Agora:</strong> ${escapeHTML(c.ddd||'')} ${escapeHTML(c.telefone||'Telefone não confirmado')} · ${escapeHTML(c.email||'Sem e-mail')}</p><details><summary>Ver o que foi recuperado e o histórico em conferência</summary><p><strong>Antes:</strong> ${escapeHTML(c.filial_antes)} · ${escapeHTML(c.telefone_antes||'')} · ${escapeHTML(c.email_antes||'')}</p><p>${Number(c.vinculos_separados)} vínculo(s) de evento preservado(s) na auditoria, fora da medição.</p>${(Array.isArray(c.historico_em_conferencia)?c.historico_em_conferencia:[]).map(h=>`<p>${escapeHTML(h.evento||'Atividade')} · ${escapeHTML(h.data||'Data não confirmada')} · <strong>Participação não comprovada</strong></p>`).join('')}</details><button class="btn-secondary" data-abrir-recuperado="${i}">Abrir cadastro</button></article>`).join('')||'<p>Nenhuma recuperação neste filtro.</p>';
  box.querySelectorAll('[data-abrir-recuperado]').forEach(b=>b.onclick=()=>{const c=auditoriaBaseCasos[Number(b.dataset.abrirRecuperado)];return abrirContatoDaAuditoria({pessoa:c.destino,filial:c.filial});});
  botao.hidden=novos.length<50||auditoriaBaseCasos.length>=Number(d?.total||0);document.getElementById('auditoriaBaseReconsultas').textContent='As possíveis duplicidades restantes ficam no filtro “Possíveis duplicidades”. Histórico em conferência impede mesclagem automática.';
 }catch(e){if(versao===auditoriaBaseConsulta)box.textContent='Não foi possível consultar a recuperação: '+e.message;}
 finally{if(versao===auditoriaBaseConsulta)botao.disabled=false;}
}
