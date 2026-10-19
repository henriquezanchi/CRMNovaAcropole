import {supabaseAdmin} from './supabaseAdmin.ts';
import {chamarClaude} from './anthropic.ts';
import {REGRAS_QUALIFICACAO,validarQualificacao,coordenarAgente,instrucoesEspecialista} from './agentes-crm.mjs';

export async function prepararAgente(pessoa:string, filial:string|null, mensagemId:number) {
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
 if(!mensagens.some(m=>Number(m.id)===Number(mensagemId)&&m.direcao==='entrada'))throw new Error('Mensagem de origem ausente do histórico da filial.');
 const historico=JSON.stringify(mensagens);
 // Limite explícito: nunca qualificar com um recorte silencioso do histórico.
 if(historico.length>180000)throw new Error('Histórico acima do limite de processamento integral; requer tratamento.');
 const metadados={filial,mensagem_origem_id:mensagemId,quantidade_mensagens:mensagens.length,gerado_em:new Date().toISOString()};
 const bloqueio={...coordenarAgente(lead,{etapa:'qualificacao',evidencia:null,restricao:null}),...metadados};
 if(bloqueio.bloqueado)return {filial,plano:bloqueio,historico,instrucoes:instrucoesEspecialista(bloqueio)};
 const resposta=await chamarClaude({apiKey:Deno.env.get('ANTHROPIC_API_KEY'),modelo:'claude-haiku-4-5-20251001',blocoCacheavel:REGRAS_QUALIFICACAO,blocoDinamico:historico,maxTokens:650,functionName:'agente-qualificacao-crm'});
 if(resposta.erro || !resposta.texto)throw new Error('Falha técnica na qualificação; tentar novamente.');
 const bruto=JSON.parse(resposta.texto.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
 const plano={...coordenarAgente(lead,validarQualificacao(bruto,mensagens)),...metadados};
 return {filial,plano,historico,instrucoes:instrucoesEspecialista(plano)};
}
