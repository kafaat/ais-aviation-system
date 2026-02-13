FROM python:3.12-slim

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
