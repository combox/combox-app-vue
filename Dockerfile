FROM node:22-bookworm AS base
WORKDIR /app/combox-app-vue
ARG COMBOX_API_VERSION=latest
COPY package*.json ./
# The repo uses a local `file:../combox-api` dependency for dev. For container builds,
# install the published npm package instead (no repo sibling checkout required).
RUN rm -f package-lock.json \
 && node -e "const fs=require('fs');const v=process.env.COMBOX_API_VERSION||'latest';const p='./package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.dependencies=j.dependencies||{};j.dependencies['combox-api']=v;fs.writeFileSync(p,JSON.stringify(j,null,2));" \
 && npm install --ignore-scripts

FROM base AS dev
COPY src ./src
COPY public ./public
COPY index.html ./index.html
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.app.json ./tsconfig.app.json
COPY webpack.config.cjs ./webpack.config.cjs
EXPOSE 4173
CMD ["npm", "run", "dev"]

FROM base AS build
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY index.html ./index.html
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.app.json ./tsconfig.app.json
COPY webpack.config.cjs ./webpack.config.cjs
RUN npm run build

FROM node:22-bookworm AS runtime
WORKDIR /app/combox-app-vue
ENV NODE_ENV=production
COPY --from=build /app/combox-app-vue/dist ./dist
COPY --from=build /app/combox-app-vue/scripts ./scripts
COPY --from=build /app/combox-app-vue/package.json ./package.json
COPY --from=build /app/combox-app-vue/package-lock.json ./package-lock.json
COPY --from=build /app/combox-app-vue/node_modules ./node_modules
EXPOSE 4173
CMD ["npm", "run", "preview"]

FROM mcr.microsoft.com/playwright:v1.52.0-noble AS e2e
WORKDIR /tests
COPY package*.json ./
ARG COMBOX_API_VERSION=latest
RUN rm -f package-lock.json \
 && node -e "const fs=require('fs');const v=process.env.COMBOX_API_VERSION||'latest';const p='./package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.dependencies=j.dependencies||{};j.dependencies['combox-api']=v;fs.writeFileSync(p,JSON.stringify(j,null,2));" \
 && npm install --ignore-scripts
COPY src ./src
COPY public ./public
COPY index.html ./index.html
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.app.json ./tsconfig.app.json
COPY webpack.config.cjs ./webpack.config.cjs
CMD ["npm", "run", "test:e2e"]
