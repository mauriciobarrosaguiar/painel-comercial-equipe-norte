from scripts.extrair_bussola_d1_corrigido import (
    localizar_consultor_bussola,
    nome_principal_representante,
    normalizar_nome,
)


def test_normaliza_representante_repetido_do_bussola():
    valor = "MAURÍCIO BARROS DE AGUIAR / MAURICIO BARROS DE AGUIAR"
    assert nome_principal_representante(valor) == "MAURICIO BARROS DE AGUIAR"


def test_localiza_consultor_oficial_pelo_representante_de_origem():
    consultores = {
        normalizar_nome("Mauricio Barros de Aguiar"): "consultor-mauricio",
        normalizar_nome("Denyse Cristina Viana Veloso Araujo"): "consultor-denyse",
    }
    assert localizar_consultor_bussola(
        "MAURICIO BARROS DE AGUIAR / MAURICIO BARROS DE AGUIAR",
        consultores,
    ) == "consultor-mauricio"


def test_nao_atribui_representante_ambiguo():
    consultores = {
        "ANA MARIA": "consultor-1",
        "ANA": "consultor-2",
    }
    assert localizar_consultor_bussola("ANA MARIA SILVA", consultores) is None
