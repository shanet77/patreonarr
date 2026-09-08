FROM node:24-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp
COPY package.json tsconfig.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY src/ ./src/
RUN npx tsc && cp src/public.html dist/public.html
VOLUME /data
EXPOSE 8080
ENV DB_PATH=/data/bridge.db COOKIES_PATH=/data/patreon-cookies.txt
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:8080/api/health').then(r=>{if(!r.ok)process.exit(1)})"
CMD ["node", "dist/index.js"]
