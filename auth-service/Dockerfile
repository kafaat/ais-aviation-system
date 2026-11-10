# Keep Python 3.12 on the official Alpine base verified by the image-security gate.
# The digest makes the scanned base reproducible; Dependabot maintains this pin.
FROM python:3.12-alpine3.24@sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8

# Alpine publishes security fixes for a release faster than the official image
# is rebuilt. On 2026-11-10 the current python:3.12-alpine3.24 tag still carried
# krb5-libs 1.22.2-r1 with sixteen HIGH advisories fixed in 1.22.3-r0, so the
# image-security gate rejected the auth image. Apply the release's published
# package updates on top of the pinned base; the digest still fixes the layers
# the upgrade starts from, and the gate decides whether the result is clean.
RUN apk upgrade --no-cache

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
