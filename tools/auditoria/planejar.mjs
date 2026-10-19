import fs from 'node:fs';import vm from 'node:vm';
const ctx=vm.createContext({distanciaLevenshtein:(a,b)=>{let p=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const n=[i];for(let j=1;j<=b.length;j++)n[j]=Math.min(n[j-1]+1,p[j]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=n;}return p[b.length];}});vm.runInContext(fs.readFileSync(new URL('../../js/leads-a-tratar.js',import.meta.url),'utf8'),ctx);
const args=process.argv.slice(2);
if(args.length!==3)throw new Error('Uso: node tools/auditoria/planejar.mjs leads.json fonte.json saida.json');
const leads=JSON.parse(fs.readFileSync(args[0],'utf8'));
const fonte=JSON.parse(fs.readFileSync(args[1],'utf8'));
const execucao=fonte[0].execucao;
const nome=v=>ctx.normalizarNomeLeadsATratar(v);
const tel=(d,n)=>{d=String(d||'').replace(/\D/g,'');n=String(n||'').replace(/\D/g,'');if(n.length===9&&n.startsWith('9'))n=n.slice(1);return d&&n.length===8&&!/^(\d)\1+$/.test(n)?d+n:null;};
const email=v=>{v=String(v||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v:null;};
const tags=v=>{if(typeof v==='string')v=JSON.parse(v);return Array.isArray(v)?v:[];};
const map=(fn)=>{const m=new Map();for(const f of fonte){const k=fn(f);if(k){if(!m.has(k))m.set(k,[]);m.get(k).push(f);}}return m;};
const porM=map(f=>String(f.matricula)),porT=map(f=>tel(f.telefone_ddd,f.telefone)),porE=map(f=>email(f.email)),porN=map(f=>nome(f.nome));
const resultado=[],pendencias=[];
const adicionar=(filial,ids,motivo,evidencias=[])=>pendencias.push({execucao,filial,pessoas_ids:[...new Set(ids)].sort(),motivo,evidencias:evidencias.map(f=>({matricula:f.matricula,unidade:f.unidade,nome:f.nome,situacao:f.situacao}))});
for(const l of leads){
 const t=tel(l.pessoaTelefoneDDD,l.pessoaTelefoneNumero),e=email(l.pessoaEmail);let c=[],metodo='',observacao='';
 if(l.matricula_mercurio){c=porM.get(String(l.matricula_mercurio))||[];metodo='matricula';if(c.some(f=>!ctx.nomesCompativeisParaAutoMesclagem(l.pessoaNome,f.nome)&& !(t&&t===tel(f.telefone_ddd,f.telefone))&& !(e&&e===email(f.email)))){observacao='Matrícula aponta para nome diferente, sem confirmação por telefone ou e-mail';}}
 else {
  const a=(t?porT.get(t)||[]:[]).filter(f=>ctx.nomesCompativeisParaAutoMesclagem(l.pessoaNome,f.nome));
  const b=(e?porE.get(e)||[]:[]).filter(f=>ctx.nomesCompativeisParaAutoMesclagem(l.pessoaNome,f.nome));
  if(a.length&&b.length){c=a.filter(f=>b.some(x=>x.matricula===f.matricula));metodo='telefone_email_nome';if(!c.length){c=[...a,...b];observacao='Telefone e e-mail apontam para matrículas diferentes';}}
  else {c=a.length?a:b;metodo=a.length?'telefone_nome':'email_nome';}
 }
 if(c.length && c.every(f=>f.situacao==='INA')) {
  const ativosRelacionados=[...(t?porT.get(t)||[]:[]),...(e?porE.get(e)||[]:[])].filter(f=>f.situacao==='ATI' && ctx.nomesCompativeisParaAutoMesclagem(l.pessoaNome,f.nome) && !c.some(x=>x.matricula===f.matricula));
  if(ativosRelacionados.length){c.push(...ativosRelacionados);observacao='Matrícula inativa com indício de ativo em outra matrícula/unidade; conferir identidade antes de retomar contato';}
 }
 c=[...new Map(c.map(f=>[String(f.matricula)+'|'+f.unidade,f])).values()];
 if(new Set(c.map(f=>f.matricula)).size>1)observacao=observacao||'Mais de uma matrícula oficial compatível: identidade precisa de conferência';
 let antes;try{antes=tags(l.tags);}catch{antes=[];observacao='Tags em formato inválido: preservar até conferência';}
 let depois=[...antes],situacao='sem_correspondencia',f=c.find(f=>f.situacao==='ATI')||c[0];
 if(observacao){situacao='identidade_ambigua';adicionar(l.filial,[l.pessoaIdentificador],observacao,c);}
 else if(f){
  if(!['ATI','INA'].includes(f.situacao)){situacao='identidade_ambigua';observacao='Situação não reconhecida na fonte';adicionar(l.filial,[l.pessoaIdentificador],observacao,c);}
  else {
   depois=antes.filter(t=>!['Ativo','Aluno Ativo','Inativo','Ex-Aluno (Inativo)','Merlin','CA','JN','PP','N1','Membro','TA'].includes(t)&& !/^N[2-7]$/.test(t)&&!t.startsWith('Lead Forte')&&!t.startsWith('Jornada:'));
   depois.push(f.situacao==='ATI'?'Ativo':'Inativo');
   const n=String(f.nivel||'').trim().toUpperCase();const nivel=['TA','CO'].includes(n)?'Merlin':['CA','JN','PP','N1'].includes(n)?n:/^N[2-7]$/.test(n)?'Membro':null;
   if(nivel)depois.push(nivel);depois=[...new Set(depois)];
   situacao=JSON.stringify([...antes].sort())===JSON.stringify([...depois].sort())?'conferido':'corrigir_tags';observacao='Correspondência inequívoca com a fonte nacional; situação '+f.situacao;
  }
 }else{
  const possiveis=porN.get(nome(l.pessoaNome))||[];
  if(possiveis.length){situacao='nome_sem_identificador';observacao='Nome coincide, mas falta matrícula ou contato para confirmar identidade';adicionar(l.filial,[l.pessoaIdentificador],observacao,possiveis);}
  else if(antes.some(t=>['Ativo','Aluno Ativo','Inativo','Ex-Aluno (Inativo)'].includes(t))){situacao='status_sem_correspondencia';observacao='Tag de aluno sem correspondência inequívoca na fonte nacional; não alterada';adicionar(l.filial,[l.pessoaIdentificador],observacao);}
 }
 resultado.push({execucao,pessoa:l.pessoaIdentificador,filial:l.filial,resultado:situacao,metodo:metodo||null,matricula:f?.matricula||null,unidade:f?.unidade||null,observacao,tags_antes:l.tags,tags_depois:JSON.stringify(depois),matricula_anterior:l.matricula_mercurio,identidade_antes:{nome:l.pessoaNome,ddd:l.pessoaTelefoneDDD,telefone:l.pessoaTelefoneNumero,email:l.pessoaEmail,matricula:l.matricula_mercurio}});
}
// Duplicidade: mesmas regras do CRM, nunca auto mescla entre filiais ou nomes incompatíveis.
for(const filial of new Set(leads.map(l=>l.filial))){const base=leads.filter(l=>l.filial===filial);const usados=new Set();
 for(const [criterio,fn] of [['telefone',l=>tel(l.pessoaTelefoneDDD,l.pessoaTelefoneNumero)],['email',l=>email(l.pessoaEmail)]]){const m=new Map();for(const l of base){if(usados.has(l.pessoaIdentificador))continue;const k=fn(l);if(!k)continue;if(!m.has(k))m.set(k,[]);m.get(k).push(l);}for(const g of m.values()){if(g.length<2)continue;g.forEach(l=>usados.add(l.pessoaIdentificador));adicionar(filial,g.map(l=>l.pessoaIdentificador),criterio==='telefone'?'Telefone compartilhado: conferir nomes e matrículas antes de unificar':'E-mail compartilhado: confirmar identidade antes de unificar');}}
 const restantes=base.filter(l=>!usados.has(l.pessoaIdentificador)&&l.pessoaNome);const tokens=new Map(),freq=new Map(),porPrimeiro=new Map();
 for(const l of restantes){const ts=ctx.tokensSignificativosNome(l.pessoaNome);tokens.set(l.pessoaIdentificador,ts);for(const t of new Set(ts))freq.set(t,(freq.get(t)||0)+1);if(ts.length){if(!porPrimeiro.has(ts[0]))porPrimeiro.set(ts[0],[]);porPrimeiro.get(ts[0]).push(l);}}
 for(const lista of porPrimeiro.values()){const vistos=new Set();for(let i=0;i<lista.length;i++){if(vistos.has(i))continue;const g=[lista[i]];for(let j=i+1;j<lista.length;j++){if(vistos.has(j))continue;if(ctx.pontuarSimilaridadeNomes(lista[i],lista[j],tokens,freq)>=75){g.push(lista[j]);vistos.add(j);}}if(g.length>1){vistos.add(i);adicionar(filial,g.map(l=>l.pessoaIdentificador),'Nomes semelhantes: indício para revisão, sem identidade comprovada');}}}
}
// Mesma identidade aparente em filiais diferentes: somente revisão, nunca unificação automática.
const paresRede=new Set();
for(const fn of [l=>tel(l.pessoaTelefoneDDD,l.pessoaTelefoneNumero),l=>email(l.pessoaEmail)]) {
 const m=new Map();for(const l of leads){const k=fn(l);if(!k)continue;if(!m.has(k))m.set(k,[]);m.get(k).push(l);}
 for(const g of m.values())for(let i=0;i<g.length;i++)for(let j=i+1;j<g.length;j++){
  if(g[i].filial===g[j].filial || !ctx.nomesCompativeisParaAutoMesclagem(g[i].pessoaNome,g[j].pessoaNome))continue;
  const ids=[g[i].pessoaIdentificador,g[j].pessoaIdentificador].sort(),k=ids.join('|');if(paresRede.has(k))continue;paresRede.add(k);
  adicionar(null,ids,'Possível mesma pessoa em filiais diferentes: pode ser transferência ou cadastro legítimo; revisar antes de unificar');
 }
}
const resumo={leads:leads.length,fonte:fonte.length,resultados:{},pendencias:pendencias.length};for(const r of resultado)resumo.resultados[r.resultado]=(resumo.resultados[r.resultado]||0)+1;
fs.writeFileSync(args[2],JSON.stringify({execucao,resultado,pendencias,resumo}),{mode:0o600});console.log(JSON.stringify(resumo));
