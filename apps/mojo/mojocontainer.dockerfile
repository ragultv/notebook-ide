# =========================
# NVIDIA GPU + Mojo Docker
# =========================
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

# Force HTTPS for Ubuntu repos
RUN sed -i 's|http://archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' /etc/apt/sources.list \
 && sed -i 's|http://security.ubuntu.com/ubuntu|https://security.ubuntu.com/ubuntu|g' /etc/apt/sources.list

# Install Python, pip, and essential tools
RUN apt-get update && apt-get install -y \
    python3 python3-pip curl git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install Mojo runtime from PyPI
RUN pip3 install --upgrade pip \
 && pip3 install mojo

# Workspace for user-submitted code
WORKDIR /workspace
VOLUME ["/workspace"]

# Expose port if running web apps or APIs
EXPOSE 8000

# Default command
CMD ["python3"]