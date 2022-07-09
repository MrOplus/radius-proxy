FROM node:16.13.2-alpine

WORKDIR /app

COPY . /app
RUN npm install
EXPOSE 1812/udp
ENV remote_port 1813
ENV remote_host 192.168.1.50
ENV secret secret
ENV enable_ampq false
ENV ampq 'amqp://guest:guest@172.16.0.10:5672'
CMD ["npm", "start"]

