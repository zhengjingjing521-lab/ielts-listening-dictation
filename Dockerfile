FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 practice && mkdir /data && chown practice /data
COPY run.py .
COPY service/ service/
COPY media/ media/
USER practice
EXPOSE 8000
ENTRYPOINT ["python","run.py","--bind","0.0.0.0","--port","8000","--data-dir","/data"]
