FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean
WORKDIR /app
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt
COPY *.py /app/
COPY *.sh /app/
COPY api/ /app/api/
COPY classifier/ /app/classifier/
COPY config/ /app/config/
COPY extraction/ /app/extraction/
COPY listener/ /app/listener/
COPY pipeline/ /app/pipeline/
COPY rules/ /app/rules/
######## NEW ########
# services/backend_webhook.py and services/auth.py are imported by
# listener/worker.py and listener/extraction_worker.py, both of which are
# imported by main.py at startup. This directory was never copied into the
# image, causing:
#   ModuleNotFoundError: No module named 'services'
# on container boot — before uvicorn even starts serving traffic.
COPY services/ /app/services/
COPY new_app/ /app/new_app/
COPY prompts/ /app/prompts/
COPY utils/ /app/utils/
COPY formulas/ /app/formulas/
######## END NEW ########
RUN addgroup --gid 1001 --system gfsgroup \
    && adduser --uid 1001 --system --ingroup gfsgroup gfsuser \
    && mkdir -p /app/output \
    && chown -R gfsuser:gfsgroup /app
USER gfsuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
