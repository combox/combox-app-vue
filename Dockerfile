FROM node:22-bookworm AS base
WORKDIR /app/combox-app-vue
COPY package*.json ./
COPY --from=combox_api . /app/combox-api
RUN node -e "const fs=require('fs');const p='/app/combox-api/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.scripts){delete j.scripts.prepare;delete j.scripts.build;}fs.writeFileSync(p,JSON.stringify(j,null,2));" \
 && npm install --ignore-scripts

FROM base AS dev
COPY src ./src
COPY public ./public
COPY index.html ./index.html
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.app.json ./tsconfig.app.json
COPY webpack.config.cjs ./webpack.config.cjs
COPY .env ./.env
EXPOSE 4173
CMD ["npm", "run", "dev"]

FROM base AS build
COPY src ./src
COPY public ./public
COPY index.html ./index.html
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.app.json ./tsconfig.app.json
COPY webpack.config.cjs ./webpack.config.cjs
COPY .env ./.env
RUN npm run build

FROM node:22-bookworm AS runtime
WORKDIR /app/combox-app-vue
ENV NODE_ENV=production
COPY --from=build /app/combox-app-vue/dist ./dist
COPY --from=build /app/combox-app-vue/package.json ./package.json
COPY --from=build /app/combox-app-vue/package-lock.json ./package-lock.json
COPY --from=build /app/combox-app-vue/node_modules ./node_modules
EXPOSE 4173
CMD ["npm", "run", "preview"]

FROM mcr.microsoft.com/playwright:v1.52.0-noble AS e2e
WORKDIR /tests
COPY --from=combox_api . /combox-api
COPY package*.json ./
RUN node -e "const fs=require('fs');const p='/combox-api/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.scripts){delete j.scripts.prepare;delete j.scripts.build;}fs.writeFileSync(p,JSON.stringify(j,null,2));" \
 && npm install --ignore-scripts
COPY src ./src
COPY public ./public
COPY index.html ./index.html
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.app.json ./tsconfig.app.json
COPY webpack.config.cjs ./webpack.config.cjs
COPY .env ./.env
CMD ["npm", "run", "test:e2e"]
