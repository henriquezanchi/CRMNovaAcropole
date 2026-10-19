import {montarConsultaAtivos,confirmaIdentidadeAtiva,lerRetornoRpc} from './consulta-ativos.mjs';
import {chamarMercury} from '../_shared/mercury.ts';
import {abrirSessaoPhpMyAdmin} from '../_shared/phpmyadmin.ts';
Deno.serve(async(req)=>{
 if(req.method!=='POST' || !Deno.env.get('FUNIL_ANALISE_TOKEN') || req.headers.get('x-funil-token')!==Deno.env.get('FUNIL_ANALISE_TOKEN'))return new Response('Não autorizado',{status:401});
 try {
  const body=await req.json().catch(()=>({}));
  if(body.fonte==='mercurio') {
   const pma=await abrirSessaoPhpMyAdmin();
   if(body.etapa==='investigar_contatos') {
    // Somente alvos explícitos. Nenhum dado de contato é devolvido na resposta HTTP.
    const ids=Array.isArray(body.ids)?[...new Set(body.ids.map(String))]:[];
    if(!ids.length||ids.length>100||ids.some(x=>!/^\d+$/.test(x)))return Response.json({ok:false,erro:'Informe até 100 identificadores numéricos'},{status:400});
    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
    const r=await fetch(url+'/rest/v1/leads_inscricoes?select=pessoaIdentificador,pessoaNome,filial,pessoaTelefoneDDD,pessoaTelefoneNumero,pessoaEmail,matricula_mercurio&'+new URLSearchParams({pessoaIdentificador:'in.('+ids.join(',')+')'}),{headers});
    if(!r.ok)throw new Error('Falha ao buscar alvos da investigação');
    const leads=await r.json();const esc=(s:any)=>String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"''");
    const condicoes=leads.flatMap((l:any)=>["cad_nome='"+esc(l.pessoaNome)+"'",...(Number.isSafeInteger(Number(l.matricula_mercurio))&&Number(l.matricula_mercurio)>0?['cad_matr='+Number(l.matricula_mercurio)]:[])]);
    if(!condicoes.length)return Response.json({ok:true,conferidos:0});
    const fonte=await pma.consultar('SELECT cad_matr,cad_nome,cad_unidade,cad_situacao,cad_nivel,cad_cel_ddd,cad_cel_fone,cad_res_ddd,cad_res_fone,cad_email FROM cadastro WHERE '+condicoes.join(' OR '),'cadastro');
    const norm=(s:any)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
    const linhas=leads.map((l:any)=>({pessoa:l.pessoaIdentificador,consultado_em:new Date().toISOString(),cadastro_antes:l,fontes:fonte.filter(f=>norm(f.cad_nome)===norm(l.pessoaNome)||Number(f.cad_matr)===Number(l.matricula_mercurio))}));
    const gravar=await fetch(url+'/rest/v1/auditoria_contatos_fontes?on_conflict=pessoa',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify(linhas)});
    if(!gravar.ok)throw new Error('Falha ao preservar evidências privadas da investigação');
    return Response.json({ok:true,conferidos:linhas.length,registros_fonte:fonte.length});
   }
   if(body.etapa==='reconsultar') {
    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const rpc=async(nome:string,args:any={})=>lerRetornoRpc(await fetch(url+'/rest/v1/rpc/'+nome,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args)}));
    let total=0;for(let i=0;i<5;i++) {
     const q=await rpc('assumir_reconsulta_auditoria');if(!q)break;
     try {
      const fonte=await pma.consultar(montarConsultaAtivos(q),'cadastro');
      const matches=fonte.filter(f=>confirmaIdentidadeAtiva(q,f));
      await rpc('concluir_reconsulta_auditoria',{p_pessoa:q.pessoa,p_ativo:matches.length>0,p_antes:q.lead,p_matricula:matches.length===1?Number(matches[0].cad_matr):null,p_nivel:matches.length===1?matches[0].cad_nivel:null,p_erro:null});total++;
     }catch(e){await rpc('concluir_reconsulta_auditoria',{p_pessoa:q.pessoa,p_ativo:false,p_antes:q.lead,p_matricula:null,p_nivel:null,p_erro:String(e?.message||e)});}
    }
    return Response.json({ok:true,contatos_reconsultados:total,escopo:'somente cadastros mesclados na fila; somente ativos'});
   }
   if(body.etapa==='estatisticas')return Response.json({ok:true,situacoes:await pma.consultar('SELECT cad_situacao, COUNT(*) quantidade, SUM(cad_baixa IS NULL) sem_baixa FROM cadastro GROUP BY cad_situacao','cadastro')});
   if(body.etapa==='coletar') {
    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
    const call=async(path:string,method='GET',data?:any)=>{const r=await fetch(url+'/rest/v1/'+path,{method,headers:{...headers,Prefer:'resolution=merge-duplicates,return=representation'},body:data?JSON.stringify(data):undefined});if(!r.ok)throw new Error('Banco da auditoria: '+r.status+' '+(await r.text()).slice(0,180));return r.json();};
    let jobs=await call('auditoria_crm_execucoes?estado=eq.coletando&order=criado_em.desc&limit=1');
    if(!jobs.length)jobs=await call('auditoria_crm_execucoes','POST',{});
    const job=jobs[0],mat=Number(job.cursor_matricula)||0,uni=String(job.cursor_unidade||'').replace(/[^A-Za-z0-9-]/g,'');
    const rows=await pma.consultar(`SELECT cad_matr,cad_unidade,cad_nome,cad_cel_ddd,cad_cel_fone,cad_email,cad_nivel,cad_situacao,cad_baixa,cad_ingresso FROM cadastro WHERE cad_matr>${mat} OR (cad_matr=${mat} AND cad_unidade>'${uni}') ORDER BY cad_matr,cad_unidade LIMIT 5000`,'cadastro');
    for(let i=0;i<rows.length;i+=500) await call('auditoria_crm_fonte?on_conflict=execucao,matricula,unidade','POST',rows.slice(i,i+500).map(r=>({execucao:job.id,matricula:Number(r.cad_matr),unidade:r.cad_unidade||'',nome:r.cad_nome,telefone_ddd:r.cad_cel_ddd,telefone:r.cad_cel_fone,email:r.cad_email,nivel:r.cad_nivel,situacao:r.cad_situacao,baixa:r.cad_baixa,ingresso:r.cad_ingresso})));
    const ultimo=rows.at(-1);await call('auditoria_crm_execucoes?id=eq.'+job.id,'PATCH',{cursor_matricula:ultimo?Number(ultimo.cad_matr):mat,cursor_unidade:ultimo?.cad_unidade||uni,fonte_completa:rows.length<5000,estado:rows.length<5000?'coletada':'coletando'});
    return Response.json({ok:true,execucao:job.id,coletados:rows.length,completa:rows.length<5000});
   }
   const tabelas=await pma.consultar("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA='oinabview'",'cadastro');
   const colunas=await pma.consultar("SELECT COLUMN_NAME,DATA_TYPE FROM information_schema.columns WHERE TABLE_SCHEMA='oinabview' AND TABLE_NAME='cadastro'",'cadastro');
   return Response.json({ok:true,tabelas,colunas});
  }
  const d=await chamarMercury<any>('/people?limit=1');const p=d.data?.[0]||{};
  return Response.json({ok:true,total_pagina:d.data?.length,campos:Object.keys(p),tipos:Object.fromEntries(Object.entries(p).map(([k,v])=>[k,Array.isArray(v)?'array':typeof v])),campos_branch:Object.keys(p.branch||{}),campos_pagina:Object.keys(d.page||{}),tem_proxima:!!d.page?.nextCursor});
 }catch(e){return Response.json({ok:false,erro:String(e?.message||e)},{status:500});}
});
