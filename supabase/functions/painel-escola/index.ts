import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { validarConsultaEscola, hashChaveEscola } from '../_shared/painel-escola.ts';
const origemPermitida = 'https://crm-nova-acropole-5dv3.vercel.app';
const headers = { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':origemPermitida, 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'content-type', 'Vary':'Origin' };
const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo),{status,headers});
Deno.serve(async req => {
    const origem = req.headers.get('Origin');
    if (origem && origem !== origemPermitida) return responder({erro:'Origem não permitida.'},403);
    if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if (req.method!=='POST') return responder({erro:'Use o link de acompanhamento.'},405);
    if (Number(req.headers.get('Content-Length') || 0)>4096) return responder({erro:'Consulta muito longa.'},413);
    try {
        const texto = await req.text();
        if (texto.length>4096) return responder({erro:'Consulta muito longa.'},413);
        let consulta;
        try { consulta=validarConsultaEscola(JSON.parse(texto)); }
        catch { return responder({erro:'Link ou consulta inválidos.'},400); }
        const {data,error}=await supabaseAdmin.rpc('consultar_painel_escola',{
            p_chave_hash:await hashChaveEscola(consulta.chave),p_busca:consulta.busca,p_categoria:consulta.categoria,p_inicio:consulta.inicio,p_limite:50,
        });
        if(error) return responder({erro:'Não foi possível consultar o acompanhamento. Tente novamente.'},503);
        if(!data) return responder({erro:'Este link expirou, foi revogado ou não é válido. Peça um novo acesso à equipe.'},401);
        return responder(data);
    } catch { return responder({erro:'Não foi possível consultar agora.'},503); }
});
