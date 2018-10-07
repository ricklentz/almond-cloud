// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

const net = require('net');
const JsonDatagramSocket = require('./json_datagram_socket');

const Config = require('../config');

class LocalTokenizerService {
    constructor() {
        const socket = new net.Socket();
        socket.connect({
            host: '127.0.0.1',
            port: 8888
        });
        this._socket = new JsonDatagramSocket(socket, socket, 'utf8');
        this._socket.on('data', (msg) => {
            let req = this._requests.get(msg.req);
            if (!req)
                return;
            this._requests.delete(msg.req);

            if (msg.error) {
                req.reject(new Error(msg.error));
            } else {
                req.resolve({
                    tokens: msg.tokens,
                    entities: msg.values
                });
            }
        });

        this._requests = new Map();
        this._nextRequest = 0;
    }

    end() {
        this._socket.end();
    }

    tokenize(languageTag, utterance) {
        const reqId = this._nextRequest++;
        return new Promise((resolve, reject) => {
            this._requests.set(reqId, { resolve, reject });

            this._socket.write({ req: reqId, utterance, languageTag });
        });
    }
}

function tokenizeWithAlmondNL(language, sentence) {
    let url = Config.NL_SERVER_URL + '/' + language + '/tokenize?q=' + encodeURIComponent(sentence);
    return Tp.Helpers.Http.get(url).then((result) => JSON.parse(result));
}

let _localTokenizer = null;
function getLocalTokenizer() {
    if (_localTokenizer)
        return _localTokenizer;
    return _localTokenizer = new LocalTokenizerService();
}

function tokenizeLocal(language, sentence) {
    return getLocalTokenizer().tokenize(language, sentence);
}

module.exports = {
    tokenize(language, sentence) {
        if (process.env.THINGENGINE_USE_TOKENIZER === 'local')
            return tokenizeLocal(language, sentence);
        else
            return tokenizeWithAlmondNL(language, sentence);
    },

    tearDown() {
        if (_localTokenizer === null)
            return;
        _localTokenizer.end();
    }
};
