# Build from the repository root:  docker build -f services/relayer/Dockerfile .
# The relayer is TypeScript run directly by bun; node and npm are used only to install from the repository lockfile.
FROM node:22-slim
RUN npm install -g bun@1.4.0 && npm cache clean --force
WORKDIR /app

# Manifests first, so the install layer is cached until a dependency changes.
COPY package.json package-lock.json ./
COPY packages/network/package.json packages/network/
COPY services/relayer/package.json services/relayer/
# The other workspaces (web app, contracts) are listed in the root package.json but not needed here.
COPY apps/web/package.json apps/web/
COPY contracts/package.json contracts/
RUN npm ci --omit=dev --workspace @waybill/relayer --workspace @waybill/network --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/network packages/network
COPY services/relayer services/relayer

ENV NODE_ENV=production
WORKDIR /app/services/relayer
# Render sets PORT; the relayer reads WAYBILL_API_PORT, set to the same value in render.yaml.
EXPOSE 10000
USER node
CMD ["bun", "src/main.ts"]
