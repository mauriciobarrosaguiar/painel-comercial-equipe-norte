const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      try {
        const database = await env.DB.prepare("SELECT 1 AS ok").first();
        const tabelas = await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).first();

        return json({
          status: "ok",
          app: "Painel Comercial Equipe Norte",
          database: Number(database?.ok || 0) === 1 ? "ok" : "erro",
          tabelas: Number(tabelas?.total || 0),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        return json(
          {
            status: "parcial",
            app: "Painel Comercial Equipe Norte",
            database: "indisponivel",
            detalhe: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          },
          503
        );
      }
    }

    if (url.pathname === "/api/dashboard") {
      try {
        const consultas = await env.DB.batch([
          env.DB.prepare("SELECT COUNT(*) AS total FROM clientes WHERE ativo = 1"),
          env.DB.prepare("SELECT COUNT(*) AS total FROM consultores WHERE ativo = 1"),
          env.DB.prepare("SELECT COALESCE(SUM(valor_faturado), 0) AS total FROM pedidos"),
          env.DB.prepare("SELECT COUNT(*) AS total FROM extracoes WHERE status = 'executando'"),
        ]);

        return json({
          clientes_ativos: Number(consultas[0]?.results?.[0]?.total || 0),
          consultores_ativos: Number(consultas[1]?.results?.[0]?.total || 0),
          vendas_faturadas: Number(consultas[2]?.results?.[0]?.total || 0),
          automacoes_executando: Number(consultas[3]?.results?.[0]?.total || 0),
        });
      } catch (error) {
        return json(
          {
            erro: "Não foi possível carregar os indicadores.",
            detalhe: error instanceof Error ? error.message : String(error),
          },
          500
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ erro: "Rota não encontrada." }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
