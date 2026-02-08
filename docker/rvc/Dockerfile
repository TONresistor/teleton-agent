# RVC Voice Conversion - CPU Only
# Lightweight image for mass distribution

FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir \
    torch==2.1.0 --index-url https://download.pytorch.org/whl/cpu \
    torchaudio==2.1.0 --index-url https://download.pytorch.org/whl/cpu \
    numpy \
    scipy \
    librosa \
    soundfile \
    faiss-cpu \
    praat-parselmouth

# Copy inference script
COPY inference.py /app/inference.py

# Create models directory
RUN mkdir -p /app/models /app/input /app/output

# Entrypoint
ENTRYPOINT ["python", "/app/inference.py"]
