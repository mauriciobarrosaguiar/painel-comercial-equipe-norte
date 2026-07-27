from src.mercadofarma_parser_atual import _texto_percentual


class Elemento:
    def __init__(self, texto: str, identificador: str):
        self.text = texto
        self.id = identificador

    def is_displayed(self):
        return True


class Raiz:
    text = "Nazaria - MA - Imperatriz 118 un. disponíveis PF Dist.: R$ 23,98 R$ 9,31 Sem imposto R$ 9,31 61,17%"

    def find_elements(self, _by, seletor):
        if "discount" in seletor:
            return [Elemento("61,17%", "desconto")]
        if seletor == "span":
            return [Elemento("PF Dist.: R$ 23,98", "pf"), Elemento("61,17%", "span-desconto")]
        return []


def test_le_desconto_exato_da_oferta():
    assert _texto_percentual(Raiz()) == "61,17%"


def test_nao_confunde_preco_com_percentual():
    raiz = Raiz()
    raiz.text = "Panpharma - GO 60 un. disponíveis R$ 9,49 60,41%"
    raiz.find_elements = lambda _by, seletor: [Elemento("60,41%", "badge")] if seletor == "span" else []
    assert _texto_percentual(raiz) == "60,41%"
