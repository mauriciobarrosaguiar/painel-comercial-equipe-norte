from datetime import date

from src.sip_store import acesso_publico_valido, normalizar_grupo_sip


def test_normalizacao_preserva_id_publico():
    grupo = normalizar_grupo_sip({"id": "abc123", "nome": "Rede Norte", "cnpjs": []})
    assert grupo["id"] == "abc123"
    assert grupo["acesso_publico_ativo"] is True


def test_acesso_inativo_e_bloqueado():
    valido, motivo = acesso_publico_valido(
        {"id": "abc123", "nome": "Rede Norte", "acesso_publico_ativo": False},
        hoje=date(2026, 7, 17),
    )
    assert valido is False
    assert "desativado" in motivo


def test_acesso_expirado_e_bloqueado():
    valido, motivo = acesso_publico_valido(
        {
            "id": "abc123",
            "nome": "Rede Norte",
            "acesso_publico_ativo": True,
            "acesso_publico_expira_em": "2026-07-16",
        },
        hoje=date(2026, 7, 17),
    )
    assert valido is False
    assert "expirou" in motivo
