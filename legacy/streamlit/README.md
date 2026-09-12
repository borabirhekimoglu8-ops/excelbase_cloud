# Eski Streamlit arayüzü (arşiv)

Bu klasör, Excelbase'in Next.js PWA + FastAPI sürümünden önceki Streamlit
arayüzünü barındırır. Artık geliştirilmez ve dağıtılmaz; yalnızca eski bir
kurulumdan veri karşılaştırmak ya da bir davranışı doğrulamak gerektiğinde
başvurulur.

Güncel uygulama depo kökünden `./run.sh` (Windows: `.\run.ps1`) ile çalışır.

## Yine de çalıştırmak gerekirse

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r legacy/streamlit/requirements.txt
cd legacy/streamlit && ../../.venv/bin/streamlit run app.py
```

`app.py`, paylaşılan okuyucuları (`excelbase_core`, `gate_visa_reader`,
`operation_helpers`, `db`, `persistence`, `photo_store`, `passenger_schema`)
depo kökünden içe aktarır; bu modüller FastAPI ve v8 tarafından da kullanıldığı
için yerlerinde kalır.
