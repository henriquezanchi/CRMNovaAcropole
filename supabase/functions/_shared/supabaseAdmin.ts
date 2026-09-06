import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente
// pela plataforma em toda Edge Function — não precisam (nem devem) ser
// setados manualmente via `supabase secrets set`.
// A service role key ignora RLS: é assim que as functions conseguem
// escrever em mensagens_whatsapp mesmo sem policy de INSERT pro público.
export const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export const NOME_TABELA_LEADS = "leads_inscricoes";
export const NOME_TABELA_MENSAGENS = "mensagens_whatsapp";
