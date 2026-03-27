# graph-caster (Python)

Интерпретатор графа: JSON-документ → обход → пошаговое выполнение с колбеками/стримом событий.

Установка из этой папки:

```bash
pip install -e .
pip install -e ".[dev]"
pytest -q
```

Запуск CLI:

```bash
python -m graph_caster --help
python -m graph_caster -d ../schemas/graph-document.example.json -s n1
```

Полная документация репозитория: [../README.md](../README.md).
