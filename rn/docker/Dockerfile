# Android build image for rn/: the shared tvbox build image (JDK 21) plus Node and npm.
# Build: docker build --label ai-agent=true -t ai-agent/tvbox-rn-build rn/docker
FROM ai-agent/tvbox-build:latest

ARG NODE_VERSION=24.19.0

RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
      | tar -xz -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE \
    && node --version && npm --version
