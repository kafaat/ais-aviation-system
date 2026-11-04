# Keep Python 3.12 on the official Alpine base verified by the image-security gate.
# The digest makes the scanned base reproducible; Dependabot maintains this pin.
FROM python:3.12-alpine3.24@sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8

WORKDIR /app

COPY requirements.txt .

# Install Python dependencies with mirror fallback for network resilience
# Try Aliyun mirror first, then Tsinghua, then default PyPI
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt || \
    pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple/ -r requirements.txt || \
    pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
