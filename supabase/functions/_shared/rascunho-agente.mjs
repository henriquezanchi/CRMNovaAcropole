import {coordenarAgente} from './agentes-crm.mjs';
// Revalida o rascunho revisado imediatamente antes de chamar a Meta.
export async function motivoRascunhoAgente(db, referencia, pessoa, filial, lead) {
 if(!referencia || !['geral','convite'].includes(referencia.tipo) || !Number.isSafeInteger(referencia.id) || referencia.id<=0)return 'Referência do rascunho inválida.';
 const tabela=referencia.tipo==='geral'?'sugestoes_resposta_wpp':'classificacoes_resposta_convite';
 const {data:r,error}=await db.from(tabela).select('status,mensagem_origem_id,agente_ia').eq('id',referencia.id).eq('pessoaIdentificador',pessoa).maybeSingle();
 if(error || !r || r.status!=='pendente')return 'Rascunho indisponível ou já encerrado. Atualize a conversa.';
 const {data:origem,error:erroOrigem}=await db.from('mensagens_whatsapp').select('filial').eq('id',r.mensagem_origem_id).eq('pessoaIdentificador',pessoa).maybeSingle();
 if(erroOrigem || !origem || origem.filial!==filial)return 'Não foi possível conferir a filial do rascunho.';
 const {data:novas,error:erroNovas}=await db.from('mensagens_whatsapp').select('id').eq('pessoaIdentificador',pessoa).eq('filial',filial).gt('id',r.mensagem_origem_id).limit(1);
 if(erroNovas || novas?.length)return 'A conversa mudou desde a sugestão. Atualize e confira o contexto antes de enviar.';
 const plano=coordenarAgente(lead,r.agente_ia?.qualificacao||{etapa:'qualificacao',restricao:null,evidencia:null});
 if(r.agente_ia?.bloqueado || plano.bloqueado)return plano.motivo||'Rascunho suspenso por restrição de contato.';
 return '';
}
