// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
Q.longStackSupport = true;
const stream = require('stream');
const rpc = require('transparent-rpc');

const Engine = require('thingengine-core');
const PlatformModule = require('./platform');
const JsonDatagramSocket = require('../util/json_datagram_socket');

const Config = require('../config');

class ParentProcessSocket extends stream.Duplex {
    constructor() {
        super({ objectMode: true });
    }

    _read() {}

    _write(data, encoding, callback) {
        process.send({ type: 'rpc', data: data }, null, callback);
    }
}

const _engines = new Map;
var _stopped = false;

function handleSignal() {
    for (let obj of _engines.values()) {
        console.log('Stopping engine of ' + obj.cloudId);
        if (obj.running)
            obj.engine.stop();

        for (let sock of obj.sockets)
            sock.end();
    }

    _stopped = true;
    if (process.connected)
        process.disconnect();

    // give ourselves 10s to die gracefully, then just exit
    setTimeout(() => {
        process.exit();
    }, 10000)
    // the timeout will not keep us alive if we're done with everything
    .unref();
}

function runEngine(thingpediaClient, options) {
    var platform = PlatformModule.newInstance(thingpediaClient, options);
    if (!PlatformModule.shared)
        global.platform = platform;

    var obj = { cloudId: options.cloudId, running: false, sockets: new Set };
    var engine = new Engine(platform, { thingpediaUrl: Config.THINGPEDIA_URL });
    obj.engine = engine;
    platform.createAssistant(engine, options);
    engine.open().then(() => {
        obj.running = true;

        if (_stopped)
            return engine.close();
        return engine.run();
    }).then(() => {
        return engine.close();
    }).catch((e) => {
        console.error('Engine ' + options.cloudId + ' had a fatal error: ' + e.message);
        console.error(e.stack);
        _engines.delete(options.userId);
    });

    _engines.set(options.userId, obj);
}

function killEngine(userId) {
    let obj = _engines.get(userId);
    if (!obj)
        return;
    _engines.delete(userId);
    obj.engine.stop();
    for (let sock of obj.sockets)
        sock.end();
}

function handleDirectSocket(userId, replyId, socket) {
    console.log('Handling direct connection for ' + userId);

    const rpcSocket = new rpc.Socket(new JsonDatagramSocket(socket, socket, 'utf8'));
    rpcSocket.on('error', (e) => {
        console.log('Error on direct RPC socket: ' + e.message);
    });

    let obj = _engines.get(userId);
    if (!obj) {
        console.log('Could not find an engine with the required user ID');
        rpcSocket.call(replyId, 'error', ['Invalid user ID ' + userId]);
        rpcSocket.end();
        return;
    }

    const platform = obj.engine.platform;
    rpcSocket.call(replyId, 'ready', [obj.engine,
        platform.getCapability('websocket-api'),
        platform.getCapability('webhook-api'),
        platform.getCapability('assistant')]);

    obj.sockets.add(rpcSocket);
    rpcSocket.on('close', () => {
        obj.sockets.delete(rpcSocket);
    });
}

function main() {
    var shared = (process.argv[2] === '--shared');

    // for compat with platform.getOrigin()
    // (but not platform.getCapability())
    if (shared)
        global.platform = PlatformModule;

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    var rpcWrapped = new ParentProcessSocket();
    var rpcSocket = new rpc.Socket(rpcWrapped);
    process.on('message', (message, socket) => {
        switch (message.type) {
            case 'direct':
                handleDirectSocket(message.target, message.replyId, socket);
                break;
            case 'rpc':
                rpcWrapped.push(message.data);
                break;
        }
    });

    var factory = {
        $rpcMethods: ['runEngine', 'killEngine'],

        runEngine: runEngine,
        killEngine: killEngine,
    };
    var rpcId = rpcSocket.addStub(factory);
    PlatformModule.init(shared);
    process.send({ type: 'ready', id: rpcId });

    // wait 10 seconds for a runEngine message
    setTimeout(() => {}, 10000);
}

main();
