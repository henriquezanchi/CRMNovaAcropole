import {supabaseAdmin} from './supabaseAdmin.ts';
import {chamarClaude} from './anthropic.ts';
import {enriquecerTranscricoes} from './transcricoes-crm.ts';
import {VERSAO_AGENTES,REGRAS_QUALIFICACAO,validarQualificacao,qualificarComEvidencia,coordenarAgente,instrucoesEspecialista,planejarLeitura,montarEntradaIA,extrairJsonIA,validarMemoria,registroMemoria,historicoParaEspecialista} from './agentes-crm.mjs';

export async function prepararAgente(pessoa:string, filial:string|null, mensagemId:number, exigirEntrada=true) {
 if(!filial){
  const {data:origem,error}=await supabaseAdmin.from('mensagens_whatsapp').select('filial').eq('id',mensagemId).eq('pessoaIdentificador',pessoa).maybeSingle();
  if(error || !origem?.filial)throw new Error('Filial não identificada; não misturar históricos.');
  filial=origem.filial;
 }
 const {data:lead,error:erroLead}=await supabaseAdmin.from('leads_inscricoes').select('tags,acompanhamento').eq('pessoaIdentificador',pessoa).eq('filial',filial).maybeSingle();
 if(erroLead || !lead)throw new Error('Cadastro indisponível para qualificação.');
 const mensagens:any[]=[];
 for(let inicio=0;;inicio+=1000){
  const {data,error}=await supabaseAdmin.from('mensagens_whatsapp').select('id,direcao,corpo_texto,tipo,criado_em,wa_status,importado_manualmente').eq('pessoaIdentificador',pessoa).eq('filial',filial).lte('id',mensagemId).order('criado_em').order('id').range(inicio,inicio+999);
  if(error)throw new Error('Histórico indisponível; tentar novamente.');
  mensagens.push(...(data||[]));if(!data || data.length<1000)break;
 }
 if(exigirEntrada && !mensagens.some(m=>Number(m.id)===Number(mensagemId)&&m.direcao==='entrada'))throw new Error('Mensagem de origem ausente do histórico da filial.');
 const enriquecidas=await enriquecerTranscricoes(supabaseAdmin,mensagens);
 // Memória anterior: sem ela (ou se a conversa mudou por trás), a IA relê tudo.
 const {data:memoria}=await supabaseAdmin.from('crm_memoria_conversa').select('resumo,perfil,proximo_passo,qualificacao,ate_mensagem_id,qtd_ate,transcritas,incrementos,versao,gerado_em').eq('filial',filial).eq('pessoa',pessoa).maybeSingle();
 const leitura=planejarLeitura(enriquecidas,memoria);
 const entrada=montarEntradaIA(leitura,memoria);
 const metadados={filial,mensagem_origem_id:mensagemId,quantidade_mensagens:mensagens.length,leitura:leitura.modo,gerado_em:new Date().toISOString()};
 const base={etapa:'qualificacao',evidencia:null,restricao:null};
 const bloqueio=coordenarAgente(lead,base);
 const semTexto=!enriquecidas.some(m=>m.direcao==='entrada'&&['texto','botao'].includes(m.tipo)&&String(m.corpo_texto||'').trim());
 const regra=bloqueio.bloqueado||semTexto;
 const criterio=VERSAO_AGENTES+(bloqueio.bloqueado?'-bloqueio':'');
 const {data:claim,error:erroClaim}=await supabaseAdmin.rpc('crm_assumir_qualificacao',{p_filial:filial,p_pessoa:pessoa,p_ate:mensagemId,p_caracteres:regra?0:entrada.length,p_criterio:criterio});
 if(erroClaim || !claim)throw new Error('fila_qualificacao_indisponivel');
 let qualificacao;
 let memoriaNova:any=null;
 if(claim.estado==='cache')qualificacao={...validarQualificacao(claim.resultado,enriquecidas),...(claim.resultado.inconclusiva?{inconclusiva:claim.resultado.inconclusiva}:{})};
 else {
  if(claim.estado!=='assumido')throw new Error('qualificacao_'+claim.estado);
  try{
   if(regra)qualificacao=base;
   else {
    const resposta=await chamarClaude({apiKey:Deno.env.get('ANTHROPIC_API_KEY'),modelo:'claude-haiku-4-5-20251001',blocoCacheavel:REGRAS_QUALIFICACAO,blocoDinamico:entrada,maxTokens:1500,functionName:'agente-qualificacao-crm'});
    if(resposta.erro || !resposta.texto)throw new Error(resposta.statusHttp ? 'Provedor de IA respondeu HTTP '+resposta.statusHttp+'.' : 'Falha técnica na qualificação; tentar novamente.');
    const bruto=extrairJsonIA(resposta.texto);
    qualificacao=qualificarComEvidencia(bruto,enriquecidas);
    memoriaNova=validarMemoria(bruto,enriquecidas,memoria);
   }
   const plano=coordenarAgente(lead,qualificacao);
   const {data:gravado,error}=await supabaseAdmin.rpc('crm_concluir_qualificacao',{p_filial:filial,p_pessoa:pessoa,p_versao:claim.versao,p_lease:claim.lease,p_ate:mensagemId,p_criterio:criterio,p_resultado:{...qualificacao,agente_efetivo:plano.agente,motivo:plano.motivo}});
   if(error || !gravado)throw new Error('qualificacao_superada');
  }catch(e){
   const mensagem=String((e as Error).message||'');
   const errosSeguros=['Qualificação com etapa inválida.','Qualificação sem evidência verificável.','Restrição sem evidência verificável.','qualificacao_superada','Falha técnica na qualificação; tentar novamente.','Resposta da IA fora do formato JSON.'];
   const erroSeguro=errosSeguros.includes(mensagem)||/^Provedor de IA respondeu HTTP \d{3}\.$/.test(mensagem) ? mensagem : 'Falha de leitura ou validação; nova tentativa agendada.';
   await supabaseAdmin.rpc('crm_concluir_qualificacao',{p_filial:filial,p_pessoa:pessoa,p_versao:claim.versao,p_lease:claim.lease,p_ate:mensagemId,p_criterio:criterio,p_resultado:null,p_erro:erroSeguro});
   throw e;
  }
  // Memória só é gravada depois da qualificação publicada; falha aqui só força releitura completa depois.
  if(memoriaNova){
   const agora=new Date().toISOString();
   const {error}=await supabaseAdmin.from('crm_memoria_conversa').upsert({filial,pessoa,...registroMemoria(memoriaNova,qualificacao,enriquecidas,leitura,memoria),gerado_em:agora,atualizado_em:agora},{onConflict:'filial,pessoa'});
   if(error)console.warn('[agentes-crm] memória não gravada:',error.message);
  }
 }
 const plano={...coordenarAgente(lead,qualificacao),...metadados};
 const historico=historicoParaEspecialista(enriquecidas,memoriaNova||(leitura.modo==='incremental'?memoria:null));
 return {filial,plano,historico,instrucoes:instrucoesEspecialista(plano)};
}
