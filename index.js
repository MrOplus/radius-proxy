const dgram  = require('node:dgram');
const radius = require('radius');
const buffer = require("buffer");
const ampq = require('amqp-connection-manager');
const fromClient = dgram.createSocket('udp4');
require('dotenv').config();
const config = {
    secret: process.env.secret || 'secret',
    local_port : process.env.local_port || '1812',
    remote_port : process.env.remote_port || 8812,
    remote_host : process.env.remote_server || '127.0.0.1',
    ampq : process.env.amqp || 'amqp://guest:guest@172.16.0.10:5672',
    enable_ampq : process.env.enable_ampq || false,
}
const timeout_duration = 500;
//region AMQP
const connection  = ampq.connect([config.ampq]);
const channelWrapper = connection.createChannel({
    json: true,
    setup: function (channel) {
        return channel.assertQueue('radius', {durable: true})
            .then(function () {
                console.log('[AMQP] Queue radius created');
            })
            .catch(function (err) {
                console.log(err.stack);
            });
    },
});

//endregion
//region Radius Proxy
fromClient.on('error', (err) => {
    console.log(`server error:\n${err.stack}`);
});
fromClient.on('message', (msg, client_info) => {
    let toServer = dgram.createSocket('udp4');
    let decoded_request = radius.decode({ packet: msg, secret: config.secret });
    toServer.send(msg,config.remote_port, config.remote_host,(err) => {
        if (err != null){
            fromClient.send(radius.encode_response({
                packet: decoded_request,
                code: 'Access-Reject',
                secret: config.secret
            }),client_info.port,client_info.address);
            toServer.close();
            console.error('Error sending response: ' + err);
        }
    });
    let timeout = setTimeout(() => {
        clearTimeout(timeout);
        toServer.close();
        fromClient.send(radius.encode_response({
            packet: decoded_request,
            code: 'Access-Reject',
            secret: config.secret
        }),client_info.port,client_info.address);
    },timeout_duration);
    toServer.on('message', (msg) => {
        try{
            clearTimeout(timeout);
            let decoded_response = radius.decode({ packet: msg, secret: config.secret });
            if (config.enable_ampq) {
                if (decoded_response.code === 'Access-Accept') {
                    channelWrapper
                        .sendToQueue('radius', {})
                        .then(() => {
                            console.log(`Sent '${username}' to Queue`);
                        })
                        .catch((err) => { console.log(`Message was rejected\n${err.stack}`) });
                    const username = decoded_request.attributes["User-Name"];
                }
            }
            fromClient.send(msg, client_info.port, client_info.address, (err) => {
                if (err) {
                    console.log(`server error:\n${err.stack}`);
                    fromClient.close();
                }
            });
        }catch (ex){
            console.log(`Error decoding response: ${ex.message}`);
        }

    });
    toServer.on('error', (err) => {
        console.log(`server error:\n${err.stack}`);
        fromClient.send(radius.encode_response({
            packet: msg,
            code: 'Access-Reject',
        }));
        toServer.close();
    });
});
fromClient.on('listening', () => {
    const address = fromClient.address();
    console.log(`server listening ${address.address}:${address.port}`);
});
fromClient.bind(config.local_port);
//endregion