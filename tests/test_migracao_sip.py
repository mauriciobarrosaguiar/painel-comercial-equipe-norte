import importlib
import sqlite3
from pathlib import Path

from src.sip_migracao import normalizar_sips_para_d1


MIGRATIONS = Path(__file__).resolve().parents[1] / "web" / "migrations"


def test_migracao_sip_preserva_ids_vinculos_e_recados():
    resultado = normalizar_sips_para_d1([
        {
            "id": "token-publico-real",
            "nome": "Rede Norte",
            "redes": ["Associada A", "Associada A"],
            "cnpjs": ["12.345.678/0001-90"],
            "meta_mes": 1000,
            "pagamento_percentual": 80,
            "acesso_publico_ativo": False,
            "recados": [{"id": "rec-1", "titulo": "Acordo", "status": "Concluído"}],
        }
    ])

    assert resultado["sips"][0]["id"] == "token-publico-real"
    assert resultado["sips"][0]["acesso_publico_ativo"] == 0
    assert resultado["sip_clientes"] == [{"sip_id": "token-publico-real", "cnpj": "12345678000190"}]
    assert len(resultado["redes"]) == 1
    assert resultado["recados"][0]["id"] == "rec-1"


def test_migracao_sip_nao_inventa_cnpj_invalido():
    resultado = normalizar_sips_para_d1([{"id": "sip-1", "nome": "SIP 1", "cnpjs": ["sem cnpj"]}])
    assert resultado["sip_clientes"] == []
    assert resultado["avisos"][0]["tipo"] == "CNPJ_INVALIDO"


def test_upserts_sip_vinculam_cnpj_oficial_e_preservam_recado(monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "conta-teste")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "token-teste")
    migrador = importlib.import_module("scripts.migrar_sips_d1")
    dados = normalizar_sips_para_d1([
        {
            "id": "sip-real",
            "nome": "Rede Real",
            "redes": ["Rede A"],
            "cnpjs": ["12.345.678/0001-90"],
            "recados": [{"id": "rec-real", "titulo": "Aviso"}],
        }
    ])

    connection = sqlite3.connect(":memory:")
    for arquivo in sorted(MIGRATIONS.glob("*.sql"), key=lambda path: int(path.stem.split("_", 1)[0])):
        connection.executescript(arquivo.read_text(encoding="utf-8"))
    connection.execute(
        "INSERT INTO clientes(id,cnpj,razao_social) VALUES('cliente-real','12345678000190','Cliente Real')"
    )

    for consulta in migrador.consultas_upsert(dados, "imp-teste", "2026-07-20T12:00:00-03:00"):
        connection.execute(consulta["sql"], consulta["params"])

    assert connection.execute("SELECT nome,ativo FROM sips WHERE id='sip-real'").fetchone() == ("Rede Real", 1)
    assert connection.execute("SELECT cliente_id FROM sip_clientes WHERE sip_id='sip-real'").fetchone() == ("cliente-real",)
    assert connection.execute("SELECT titulo FROM sip_recados WHERE id='rec-real'").fetchone() == ("Aviso",)
