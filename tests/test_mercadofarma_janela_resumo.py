import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from scripts.janela_mercadofarma import TZ, horario_permitido, segundos_ate_bloqueio, validar_janela
from scripts.resumir_mercadofarma_ufs import montar_resumo


class MercadoFarmaJanelaTests(unittest.TestCase):
    def test_limites_brasilia(self):
        for hora, minuto, esperado in [(6, 59, False), (7, 0, True), (19, 59, True), (20, 0, False)]:
            with self.subTest(hora=hora, minuto=minuto):
                agora = datetime(2026, 10, 22, hora, minuto, tzinfo=TZ)
                self.assertEqual(horario_permitido(agora), esperado)
        with self.assertRaises(RuntimeError):
            validar_janela(datetime(2026, 10, 22, 20, 0, tzinfo=TZ))

    def test_timeout_encerra_antes_das_20(self):
        agora = datetime(2026, 10, 22, 19, 58, tzinfo=TZ)
        self.assertEqual(segundos_ate_bloqueio(agora), 110)

    def test_resumo_identifica_uf_etapa_motivo(self):
        with tempfile.TemporaryDirectory() as base:
            status = Path(base) / "status"
            status.mkdir()
            (status / "mercadofarma_MT.json").write_text(json.dumps({
                "uf": "MT", "status": "sucesso", "total_produtos": 441
            }))
            (status / "mercadofarma_TO.json").write_text(json.dumps({
                "uf": "TO", "status": "erro", "etapa": "login",
                "erro": "HTTPConnectionPool(localhost): Read timed out 120s"
            }))
            resultado = montar_resumo(["MT", "TO"], Path(base), "failure", "success")
            self.assertEqual(resultado["status"], "erro")
            self.assertIn("UF MT | SUCESSO", resultado["mensagem"])
            self.assertIn("UF TO | ERRO | etapa login", resultado["mensagem"])
            self.assertIn("Read timed out 120s", resultado["erro"])

    def test_sem_status_nao_inventa_sucesso(self):
        with tempfile.TemporaryDirectory() as base:
            resultado = montar_resumo(["PA"], Path(base), "failure", "success")
            self.assertEqual(resultado["status"], "erro")
            self.assertIn("relatório de execução ausente", resultado["erro"])


if __name__ == "__main__":
    unittest.main()
