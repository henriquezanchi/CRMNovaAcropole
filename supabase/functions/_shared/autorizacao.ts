// Reconhece chamadas feitas por outra Edge Function, cron ou scraper com a
// chave de servidor (service_role). A chave pública do navegador também passa
// pela verificação de JWT do Supabase, então ela sozinha não prova que a
// chamada é interna.
export function ehChamadaDeServidor(req: Request): boolean {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const chaveServidor = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    return token !== "" && chaveServidor !== "" && token === chaveServidor;
}
