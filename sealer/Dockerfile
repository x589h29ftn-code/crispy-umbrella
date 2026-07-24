# Sealer-sidecar: PAdES-verzegeling met pyHanko. Niet publiek bereikbaar.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# build-essential is nodig voor enkele crypto-wheels; daarna weer verwijderen.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential \
    && apt-get autoremove -y

COPY main.py drivers.py ./

# Non-root.
RUN useradd --create-home --uid 10001 sealer
USER sealer

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
