FROM python:3.13-slim


WORKDIR /app


COPY . .


RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    "google-genai==1.65.0" \
    python-multipart \
    pillow


EXPOSE 8080


CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8080"]