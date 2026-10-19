const escapar=v=>String(v||'').replace(/'/g,"''");
const dig=v=>String(v||'').replace(/\D/g,'');
export function montarConsultaAtivos(caso) {
 const l=caso.lead||{},condicoes=[];
 const mats=[...new Set([...(caso.matriculas||[]),l.matricula_mercurio].map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))];
 if(mats.length)condicoes.push('cad_matr IN ('+mats.join(',')+')');
 if(String(l.nome||'').trim())condicoes.push("cad_nome='"+escapar(l.nome)+"'");
 if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email||''))condicoes.push("LOWER(cad_email)='"+escapar(l.email.toLowerCase())+"'");
 const d=dig(l.ddd),n=dig(l.telefone);if(d&&[8,9].includes(n.length))condicoes.push("(cad_cel_ddd='"+d+"' AND cad_cel_fone IN ('"+n+"','"+n.slice(-8)+"','9"+n.slice(-8)+"'))");
 return 'SELECT cad_matr,cad_nome,cad_unidade,cad_situacao,cad_nivel,cad_cel_ddd,cad_cel_fone,cad_email FROM cadastro WHERE cad_situacao=\'ATI\' AND ('+(condicoes.join(' OR ')||'1=0')+')';
}
const tokens=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]/g,'').split(/\s+/).filter(x=>x&&!['DE','DA','DO','DOS','DAS','E'].includes(x));
const nomes=(a,b)=>{a=tokens(a);b=tokens(b);if(!a.length||!b.length)return false;if(a.length>b.length)[a,b]=[b,a];const usados=new Set();return a.every(x=>{const i=b.findIndex((y,i)=>!usados.has(i)&&(x===y||x.length===1&&y.startsWith(x)||y.length===1&&x.startsWith(y)));if(i<0)return false;usados.add(i);return true;});};
const telefone=(d,n)=>dig(d)+dig(n).slice(-8);
export function confirmaIdentidadeAtiva(caso,f) {
 const l=caso.lead||{};
 if(f.cad_situacao!=='ATI')return false;
 const porMatricula=[...(caso.matriculas||[]),l.matricula_mercurio].filter(Boolean).map(String).includes(String(f.cad_matr));
 const porTelefone=dig(l.telefone).length>=8&&telefone(l.ddd,l.telefone)===telefone(f.cad_cel_ddd,f.cad_cel_fone);
 const porEmail=!!l.email&&String(l.email).trim().toLowerCase()===String(f.cad_email||'').trim().toLowerCase();
 return (porMatricula&&nomes(l.nome,f.cad_nome))||((porTelefone||porEmail)&&(porMatricula||nomes(l.nome,f.cad_nome)));
}
