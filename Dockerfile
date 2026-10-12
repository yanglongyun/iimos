# iimos 服务器版:没有窗口,一直醒着,手机和电脑经中继(端到端加密)连进来。
#
#   docker build -t iimos .
#   docker run -d --name iimos --restart unless-stopped -v iimos:/data iimos
#   docker logs iimos          # 第一次启动会打出配对二维码和链接
#
# 电脑操作和浏览器在服务器上没有;在你的电脑上装桌面版,用 iimos hands link 把手借过来。
FROM node:22-slim

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    IIMOS_HOME=/data \
    NODE_ENV=production
WORKDIR /opt/iimos

# agent 的 shell 里常用的东西
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# 界面编译要用 esbuild、react(在 devDependencies 里);electron 不下载
RUN npm ci --include=dev --ignore-scripts && npm cache clean --force

COPY launcher ./launcher
COPY protocol ./protocol
COPY hands/*.js ./hands/
COPY app ./app
RUN node launcher/cli-build.js \
    && ln -s /opt/iimos/launcher/cli.js /usr/local/bin/iimos && chmod +x launcher/cli.js

VOLUME /data
CMD ["node", "launcher/serve.js"]
