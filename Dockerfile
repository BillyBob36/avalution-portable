FROM node:20-alpine

# Curl utilisé par le HEALTHCHECK
RUN apk add --no-cache curl

WORKDIR /app

# Cache des deps : installer AVANT de copier le code
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Code applicatif + assets (avatars/, backgrounds/, login.html, etc.)
# Le .dockerignore exclut node_modules, .env, backups/, raw-full.zip, scripts/
COPY . .

# Le serveur écoute sur PORT (default 3000). En Coolify, set PORTS_EXPOSES=3000.
ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/login.html >/dev/null || exit 1

CMD ["npm", "start"]
