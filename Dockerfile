# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base

WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

FROM base AS build

ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web

RUN pnpm build

FROM build AS api-files

RUN pnpm --filter @tw-stock-dashboard/api deploy --legacy --prod /opt/api

FROM node:24-bookworm-slim AS api

WORKDIR /app
ENV NODE_ENV=production

COPY --from=api-files /opt/api ./

USER node
EXPOSE 3001

CMD ["node", "dist/main.js"]

FROM nginx:1.29-alpine AS web

COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
