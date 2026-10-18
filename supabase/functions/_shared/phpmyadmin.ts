// Cliente de LEITURA do banco de consulta do Mercúrio, via phpMyAdmin 5.2
// (não temos conexão MySQL direta). Duas camadas de login, iguais ao
// Mercúrio antigo: autenticação HTTP básica do servidor + formulário do
// phpMyAdmin. Os resultados vêm pela exportação em JSON (rota /export), que
// devolve todas as linhas — a tela de resultado do phpMyAdmin corta em 25.
//
// Secrets: MERCURIO_DB_PHPMYADMIN_URL, MERCURIO_DB_USUARIO, MERCURIO_DB_SENHA,
// MERCURIO_DB_HTTP_USUARIO, MERCURIO_DB_HTTP_SENHA.

export const BANCO_MERCURIO = "oinabview";

function env(nome: string): string {
    const v = Deno.env.get(nome);
    if (!v) throw new Error(`Secret ${nome} não configurado`);
    return v;
}

export async function abrirSessaoPhpMyAdmin() {
    const base = env("MERCURIO_DB_PHPMYADMIN_URL").replace(/\/+$/, "") + "/";
    const basic = "Basic " + btoa(`${env("MERCURIO_DB_HTTP_USUARIO")}:${env("MERCURIO_DB_HTTP_SENHA")}`);
    const jar = new Map<string, string>();

    async function req(caminho: string, form?: Record<string, string>) {
        let url = base + caminho;
        let method = form ? "POST" : "GET";
        let corpo = form;
        for (let i = 0; i < 6; i++) {
            const res = await fetch(url, {
                method,
                redirect: "manual",
                headers: {
                    Authorization: basic,
                    Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
                    ...(corpo ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
                },
                body: corpo ? new URLSearchParams(corpo).toString() : undefined,
            });
            for (const c of res.headers.getSetCookie()) {
                const par = c.split(";")[0];
                const k = par.slice(0, par.indexOf("="));
                const v = par.slice(par.indexOf("=") + 1);
                if (!v || v === "deleted") jar.delete(k); else jar.set(k, v);
            }
            const destino = res.headers.get("location");
            if (res.status >= 300 && res.status < 400 && destino) {
                await res.body?.cancel();
                url = new URL(destino, url).toString();
                method = "GET";
                corpo = undefined;
                continue;
            }
            return { status: res.status, texto: await res.text() };
        }
        throw new Error("phpMyAdmin: redirecionamentos demais");
    }

    const pagina = await req("index.php");
    if (pagina.status === 401) throw new Error("phpMyAdmin: autenticação HTTP recusada");
    let token = pagina.texto.match(/name="token" value="([^"]+)"/)?.[1] ?? "";
    const login = await req("index.php", {
        pma_username: env("MERCURIO_DB_USUARIO"),
        pma_password: env("MERCURIO_DB_SENHA"),
        server: "1",
        token,
        route: "/",
    });
    if (/name="pma_username"/.test(login.texto)) throw new Error("phpMyAdmin: usuário ou senha recusados");
    token = login.texto.match(/name="token" value="([^"]+)"/)?.[1] ?? token;

    // Só SELECT. Devolve as linhas como objetos (valores em texto).
    async function consultar(sql: string, tabela: string): Promise<Record<string, string | null>[]> {
        if (!/^\s*select\b/i.test(sql)) throw new Error("phpMyAdmin: só consultas SELECT");
        const r = await req("index.php?route=/export", {
            token, server: "1", db: BANCO_MERCURIO, table: tabela, single_table: "true",
            export_type: "table", sql_query: sql, export_method: "quick", quick_or_custom: "quick",
            what: "json", output_format: "sendit", charset: "utf-8", json_structure_or_data: "data",
            allrows: "1", filename_template: "export", compression: "none",
        });
        let blocos: any[];
        try { blocos = JSON.parse(r.texto); } catch {
            throw new Error(`phpMyAdmin: exportação não devolveu JSON (${r.texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)})`);
        }
        return blocos.find((b) => b && b.type === "table")?.data ?? [];
    }

    return { consultar };
}

// O MySQL do Mercúrio guarda "data vazia" como 0000-00-00.
export function dataOuNull(v: string | null | undefined): string | null {
    if (!v || v.startsWith("0000")) return null;
    return v.slice(0, 10);
}
